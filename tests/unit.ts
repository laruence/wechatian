/**
 * Node unit tests: pure logic + fake-vault integration for the core modules.
 * Bundled by esbuild (see build script) and run with `node --test`.
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import type { App } from 'obsidian';
import type { HttpTransport, HttpResponse } from '../src/core/http';
import { lowerHeaders } from '../src/core/http';
import { parseAesKey, encryptEcb, decryptEcb, downloadUrl, detectImageExt, md5Hex, ecbPaddedSize } from '../src/core/crypto';
import { extractLinks } from '../src/core/article';
import { importMessage, sanitizeFileName, dayStamp, timeOfDay, quoteBlock, ensureFolder } from '../src/core/importer';
import type { InboundMessage } from '../src/core/types';
import {
  applyLanguage,
  resolvedLanguage,
  t,
  buildReceiptReplies,
  buildSendFailure,
  classifySendFailure,
  dictionaries,
} from '../src/i18n';
import { Outbox } from '../src/outbox';
import { StateStore } from '../src/core/store';
import { IlinkClient } from '../src/core/ilink';
import { agentGuideMeta } from '../src/core/agent-guide';
import type { WechatianSettings } from '../src/settings';
import { DEFAULT_SETTINGS } from '../src/settings';

// Node has no `window`; some modules (StateStore, article) schedule via window.setTimeout
(globalThis as { window?: unknown }).window = globalThis;

/* ---------------------------------------------------------------- helpers */

/** Minimal in-memory fake of the subset of the Obsidian vault adapter we use */
class FakeVault {
  files = new Map<string, string>();
  bins = new Map<string, Uint8Array>();
  folders = new Set<string>();
  writeShouldFail = false;

  adapter = {
    // a "folder" exists when it is registered as one or is a prefix of any file path
    exists: async (p: string) =>
      this.files.has(p) ||
      this.folders.has(p) ||
      [...this.files.keys()].some((f) => f.startsWith(`${p}/`)),
    read: async (p: string) => {
      if (!this.files.has(p)) throw new Error(`ENOENT: ${p}`);
      return this.files.get(p)!;
    },
    write: async (p: string, c: string) => {
      if (this.writeShouldFail) throw new Error('disk full');
      this.files.set(p, c);
    },
    writeBinary: async (p: string, c: ArrayBuffer) => {
      if (this.writeShouldFail) throw new Error('disk full');
      this.bins.set(p, new Uint8Array(c));
    },
    remove: async (p: string) => {
      this.files.delete(p);
      this.bins.delete(p);
    },
    list: async (p: string) => ({
      files: [...this.files.keys()].filter((f) => f.startsWith(`${p}/`)),
      folders: [],
    }),
  };

  app = {
    vault: {
      adapter: this.adapter,
      create: async (p: string, c: string) => this.adapter.write(p, c),
      createFolder: async (p: string) => {
        this.folders.add(p);
      },
      getAbstractFileByPath: () => null,
    },
  } as unknown as App;
}

/** Stub transport: empty 200 responses; records requests */
class StubTransport implements HttpTransport {
  requests: Array<{ method: string; url: string; body?: string | ArrayBuffer }> = [];
  response: { status: number; body: string } = { status: 200, body: '{}' };

  private async run(method: 'GET' | 'POST', url: string, _headers: Record<string, string>, body: string | ArrayBuffer | undefined): Promise<HttpResponse> {
    this.requests.push({ method, url, body });
    return { status: this.response.status, body: new TextEncoder().encode(this.response.body).buffer as ArrayBuffer, headers: lowerHeaders({}) };
  }
  get(url: string, headers: Record<string, string>, _timeoutMs: number): Promise<HttpResponse> {
    return this.run('GET', url, headers, undefined);
  }
  post(url: string, headers: Record<string, string>, body: string | ArrayBuffer, _timeoutMs: number): Promise<HttpResponse> {
    return this.run('POST', url, headers, body);
  }
}

const MSG = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  from: 'user123',
  messageId: 'm1',
  timeMs: new Date(2026, 7, 27, 14, 30).getTime(), // 2026-08-27 14:30 local
  text: '',
  attachments: [],
  raw: {},
  ...over,
});

const SETTINGS = (over: Partial<WechatianSettings> = {}): WechatianSettings => ({ ...DEFAULT_SETTINGS, ...over });

const IMPORT_OPTS = {
  inboxFolder: 'Wechatian',
  attachmentFolder: 'Wechatian/attachments',
  articleFolder: 'Wechatian/articles',
  fetchArticles: false,
  groupArticlesByAccount: false,
};

/* ---------------------------------------------------------------- crypto */

test('parseAesKey: 16 raw bytes', () => {
  const raw = Buffer.from('0123456789abcdef'); // exactly 16 bytes
  const key = parseAesKey(raw.toString('base64'));
  assert.ok(key);
  assert.equal(key!.length, 16);
  assert.equal(key!.toString(), '0123456789abcdef');
});

test('parseAesKey: 32-char hex wrapped in base64', () => {
  const hex = '0123456789abcdef0123456789abcdef';
  const key = parseAesKey(Buffer.from(hex).toString('base64'));
  assert.ok(key);
  assert.equal(key!.length, 16);
  assert.equal(key!.toString('hex'), hex);
});

test('parseAesKey: rejects garbage', () => {
  assert.equal(parseAesKey('short'), null);
  assert.equal(parseAesKey(Buffer.from('zz'.repeat(16)).toString('base64')), null);
});

test('encrypt/decrypt ECB roundtrip', () => {
  const key = Buffer.from('0123456789abcdef');
  const plain = Buffer.from('hello wechatian — some unicode too');
  const enc = encryptEcb(plain, key);
  assert.notDeepEqual(enc, plain);
  assert.deepEqual(decryptEcb(enc, key), plain);
});

test('downloadUrl encoding', () => {
  const u = downloadUrl('https://cdn.example.com/', 'a b+c/d=');
  assert.equal(u, 'https://cdn.example.com/download?encrypted_query_param=a%20b%2Bc%2Fd%3D');
});

test('detectImageExt magic bytes', () => {
  assert.equal(detectImageExt(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(detectImageExt(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])), 'png');
  assert.equal(detectImageExt(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00])), 'gif');
  const riff = new Uint8Array(12);
  riff.set(Uint8Array.from([0x52, 0x49, 0x46, 0x46]), 0); // RIFF
  riff.set(Uint8Array.from([0x57, 0x45, 0x42, 0x50]), 8); // WEBP
  assert.equal(detectImageExt(riff), 'webp');
  assert.equal(detectImageExt(Uint8Array.from([0, 0, 0, 0])), 'jpg'); // unknown -> jpg fallback
});

test('md5Hex / ecbPaddedSize', () => {
  assert.equal(md5Hex(new TextEncoder().encode('abc')), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(ecbPaddedSize(0), 16);
  assert.equal(ecbPaddedSize(15), 16);
  assert.equal(ecbPaddedSize(16), 32); // PKCS7 always pads
  assert.equal(ecbPaddedSize(17), 32);
});

/* ----------------------------------------------------------- pure helpers */

test('sanitizeFileName', () => {
  assert.equal(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
  assert.equal(sanitizeFileName('note #1 [draft]^'), 'note _1 _draft__');
  assert.equal(sanitizeFileName('   '), 'untitled');
  assert.equal(sanitizeFileName(''), 'untitled');
});

test('dayStamp / timeOfDay', () => {
  const ts = new Date(2026, 0, 5, 9, 7).getTime();
  assert.equal(dayStamp(ts), '2026-01-05');
  assert.equal(timeOfDay(ts), '09:07');
});

test('quoteBlock prefixes every line', () => {
  assert.deepEqual(quoteBlock('a\n\nb'), ['> a', '> ', '> b']);
  assert.deepEqual(quoteBlock('  '), ['> ']); // an all-space body still renders as one empty bubble line
});

test('extractLinks strips trailing punctuation and CJK stops', () => {
  assert.deepEqual(extractLinks('see https://a.com/x. and more'), ['https://a.com/x']);
  assert.deepEqual(extractLinks('两个链接 http://a.com 和 http://b.com'), ['http://a.com', 'http://b.com']);
  assert.deepEqual(extractLinks('中文标点，后面是链接：https://a.com/x，后面'), ['https://a.com/x']);
  assert.deepEqual(extractLinks('no links here'), []);
});

/* -------------------------------------------------------------- i18n */

test('dictionaries: en/zh/tw key parity', () => {
  const enKeys = Object.keys(dictionaries.en).sort();
  for (const name of ['zh', 'tw'] as const) {
    const keys = Object.keys(dictionaries[name]).sort();
    assert.deepEqual(keys, enKeys, `${name} dictionary keys must match en`);
  }
});

test('applyLanguage / resolvedLanguage / t', () => {
  applyLanguage('en');
  assert.equal(resolvedLanguage(), 'en');
  assert.equal(t('reply.received'), '**Received**');
  applyLanguage('zh');
  assert.equal(resolvedLanguage(), 'zh');
  assert.equal(t('reply.received'), '**收到**');
  applyLanguage('tw');
  assert.equal(resolvedLanguage(), 'tw');
  assert.equal(t('set.autoReply'), '總是回覆');
  assert.equal(t('reply.recorded'), '**收到**');
  applyLanguage('en');
});

/* ------------------------------------------------- receipt reply assembly */

const RECEIPT_OK = { ok: true, appended: true, dailyNote: 'Wechatian/2026-08-27.md', attachmentPaths: [], attachmentFailures: [], linkCount: 0, articleAssets: [] };

test('buildReceiptReplies: plain text records the daily note path', () => {
  applyLanguage('zh');
  assert.deepEqual(buildReceiptReplies([RECEIPT_OK]), ['**收到** <small>Wechatian/2026-08-27.md</small>']);
});

test('buildReceiptReplies: append failure falls back to plain received', () => {
  applyLanguage('zh');
  assert.deepEqual(buildReceiptReplies([{ ...RECEIPT_OK, appended: false }]), ['**收到**']);
});

test('buildReceiptReplies: import failure', () => {
  applyLanguage('zh');
  const lines = buildReceiptReplies([{ ok: false, appended: false, dailyNote: '', attachmentPaths: [], attachmentFailures: [], linkCount: 0, articleAssets: [] }]);
  assert.deepEqual(lines, ['消息已收到,但写入 vault 失败。']);
});

test('buildReceiptReplies: attachments become a File | Saved-to table', () => {
  applyLanguage('zh');
  const lines = buildReceiptReplies([
    { ...RECEIPT_OK, attachmentPaths: ['Wechatian/attachments/2026-08-27_1430_a.jpg', 'Wechatian/attachments/2026-08-27_1430_doc.pdf'] },
  ]);
  assert.deepEqual(lines, [
    '| 文件 | 保存位置 |',
    '| --- | --- |',
    '| 2026-08-27_1430_a.jpg | Wechatian/attachments/2026-08-27_1430_a.jpg |',
    '| 2026-08-27_1430_doc.pdf | Wechatian/attachments/2026-08-27_1430_doc.pdf |',
  ]);
});

test('buildReceiptReplies: multiple messages merge attachments into one table', () => {
  applyLanguage('zh');
  const lines = buildReceiptReplies([
    { ...RECEIPT_OK, attachmentPaths: ['Wechatian/attachments/a.jpg'] },
    { ...RECEIPT_OK, attachmentPaths: ['Wechatian/attachments/b.pdf'] },
  ]);
  assert.deepEqual(lines, [
    '| 文件 | 保存位置 |',
    '| --- | --- |',
    '| a.jpg | Wechatian/attachments/a.jpg |',
    '| b.pdf | Wechatian/attachments/b.pdf |',
  ]);
});

test('buildReceiptReplies: pipes in paths are escaped inside the table', () => {
  applyLanguage('en');
  const lines = buildReceiptReplies([{ ...RECEIPT_OK, attachmentPaths: ['Wechatian/attachments/a|b.jpg'] }]);
  assert.ok(lines.includes('| a\\|b.jpg | Wechatian/attachments/a\\|b.jpg |'));
});

test('buildReceiptReplies: article rows join the table — title | note path, assets line subdued', () => {
  applyLanguage('zh');
  const saved = buildReceiptReplies([
    { ...RECEIPT_OK, articleAssets: [{ title: 'Foo', note: 'Wechatian/articles/2026-08-27 Foo.md', assetsDir: 'Wechatian/articles/assets', assetCount: 3 }], linkCount: 1 },
  ]);
  assert.deepEqual(saved, [
    '| 文件 | 保存位置 |',
    '| --- | --- |',
    '| Foo | Wechatian/articles/2026-08-27 Foo.md |',
    '| <small>3 张配图,保存在 Wechatian/articles/assets</small> | |',
  ]);
  const noAssets = buildReceiptReplies([{ ...RECEIPT_OK, articleAssets: [{ title: 'T', note: 'N.md', assetsDir: 'D', assetCount: 0 }], linkCount: 1 }]);
  assert.deepEqual(noAssets, ['| 文件 | 保存位置 |', '| --- | --- |', '| T | N.md |']);
});

test('buildReceiptReplies: files and articles share one table', () => {
  applyLanguage('en');
  const lines = buildReceiptReplies([
    { ...RECEIPT_OK, attachmentPaths: ['Wechatian/attachments/a.jpg'] },
    { ...RECEIPT_OK, articleAssets: [{ title: 'Bar', note: 'Wechatian/articles/Bar.md', assetsDir: 'D', assetCount: 2 }], linkCount: 1 },
  ]);
  assert.deepEqual(lines, [
    '| File | Saved to |',
    '| --- | --- |',
    '| a.jpg | Wechatian/attachments/a.jpg |',
    '| Bar | Wechatian/articles/Bar.md |',
    '| <small>2 image(s) attached, saved to D</small> | |',
  ]);
});

test('buildReceiptReplies: link present but article fetch failed', () => {
  applyLanguage('zh');
  const failed = buildReceiptReplies([{ ...RECEIPT_OK, linkCount: 2 }]);
  assert.deepEqual(failed, ['收到链接,但文章抓取失败。']);
});

test('buildReceiptReplies follows the active language', () => {
  applyLanguage('tw');
  const lines = buildReceiptReplies([{ ...RECEIPT_OK, attachmentPaths: ['Wechatian/attachments/a.jpg'] }]);
  assert.ok(lines[0].includes('檔案'));
  applyLanguage('en');
  const enLines = buildReceiptReplies([RECEIPT_OK]);
  assert.ok(enLines[0].startsWith('**Received'));
});

/* ------------------------------------------------------- failure classify */

test('classifySendFailure: missing credential -> noToken', () => {
  assert.equal(classifySendFailure({ ret: 0, errmsg: 'missing context_token: the user must message the bot first', contextToken: '' }), 'noToken');
  assert.equal(classifySendFailure({ ret: 0, errmsg: '', contextToken: '   ' }), 'noToken');
});

test('classifySendFailure: gateway categories', () => {
  assert.equal(classifySendFailure({ ret: -1, errmsg: 'no permission', contextToken: 'tok' }), 'rateLimited');
  assert.equal(classifySendFailure({ ret: -14, errmsg: 'session expired', contextToken: 'tok' }), 'sessionExpired');
  assert.equal(classifySendFailure({ ret: -1, errmsg: 'fetch failed', contextToken: 'tok' }), 'network');
  assert.equal(classifySendFailure({ ret: 0, errmsg: 'mystery', contextToken: 'tok' }), 'unknown');
});

test('buildSendFailure includes a fix hint', () => {
  applyLanguage('zh');
  const out = buildSendFailure('missing context_token', 0, '');
  assert.ok(out.includes('还没有发送凭据'));
  assert.ok(out.includes('先从微信给机器人发'));
  const net = buildSendFailure('fetch failed', -1, 'tok');
  assert.ok(net.includes('网络错误'));
  applyLanguage('en');
});

/* ------------------------------------------------------- importMessage */

test('importMessage: text message -> daily note with metadata and quote', async () => {
  const v = new FakeVault();
  const r = await importMessage(v.app, new StubTransport(), MSG({ text: 'hello world' }), IMPORT_OPTS);
  assert.equal(r.appended, true);
  assert.equal(r.dailyNote, 'Wechatian/2026-08-27.md');
  const note = v.files.get('Wechatian/2026-08-27.md')!;
  assert.ok(note.startsWith('---\ndate: 2026-08-27\nsender: user123\n---'));
  assert.ok(note.includes('hello world'));
  assert.ok(note.includes('14:30'));
});

test('importMessage: appends to an existing daily note', async () => {
  const v = new FakeVault();
  await importMessage(v.app, new StubTransport(), MSG({ text: 'first' }), IMPORT_OPTS);
  const r2 = await importMessage(v.app, new StubTransport(), MSG({ messageId: 'm2', text: 'second' }), IMPORT_OPTS);
  assert.equal(r2.appended, true);
  const note = v.files.get('Wechatian/2026-08-27.md')!;
  assert.ok(note.includes('first'));
  assert.ok(note.includes('second'));
  assert.equal(note.split('---').length, 3, 'header written exactly once');
});

test('importMessage: attachments saved with vault path in result', async () => {
  const v = new FakeVault();
  const data = new TextEncoder().encode('fake-jpeg-bytes');
  const msg = MSG({ attachments: [
    { kind: 'image', name: 'photo.jpg', mime: 'image/jpeg', data },
    { kind: 'file', name: 'report.pdf', mime: 'application/pdf', data },
  ] });
  const r = await importMessage(v.app, new StubTransport(), msg, IMPORT_OPTS);
  assert.equal(r.attachmentPaths.length, 2);
  assert.equal(r.attachmentFailures.length, 0);
  assert.ok(r.attachmentPaths[0].startsWith('Wechatian/attachments/'));
  assert.ok(r.attachmentPaths[0].endsWith('photo.jpg'));
  for (const p of r.attachmentPaths) {
    assert.ok(v.bins.has(p), `binary stored at ${p}`);
  }
});

test('importMessage: attachment failure is recorded, import continues', async () => {
  const v = new FakeVault();
  const data = new TextEncoder().encode('bytes');
  v.writeShouldFail = true;
  const r = await importMessage(v.app, new StubTransport(), MSG({ attachments: [{ kind: 'image', name: 'photo.jpg', mime: 'image/jpeg', data }] }), IMPORT_OPTS);
  assert.equal(r.attachmentPaths.length, 0);
  assert.deepEqual(r.attachmentFailures, ['photo.jpg']);
});

/* ------------------------------------------------------------- outbox */

function outboxFixture() {
  const v = new FakeVault();
  const store = new StateStore(v.app, 'plugin/state.json');
  store.update((s) => {
    s.scannedUser = 'user123';
    s.contextTokens['user123'] = 'tok-1';
  });
  const transport = new StubTransport();
  const client = new IlinkClient(transport, { baseUrl: 'https://gw.example', cdnBase: 'https://cdn.example' }, 'bottoken');
  const outbox = new Outbox(v.app);
  const flush = (opts: Partial<{ folder: string; inboxFolder: string; attachmentFolder: string }> = {}) =>
    outbox.flush(
      client,
      store,
      opts.folder ?? 'Wechatian/outbox',
      opts.inboxFolder ?? 'Wechatian',
      opts.attachmentFolder ?? 'Wechatian/attachments',
    );
  return { v, transport, client, store, flush };
}

test('outbox: missing folder is a no-op', async () => {
  const { flush } = outboxFixture();
  assert.equal(await flush(), 0);
});

test('outbox: .md success deletes file and records the send', async () => {
  const { v, transport, flush } = outboxFixture();
  await v.adapter.write('Wechatian/outbox/hello.md', '**done**');
  const n = await flush();
  assert.equal(n, 1);
  assert.equal(v.files.has('Wechatian/outbox/hello.md'), false, 'file deleted after success');
  const sendReq = transport.requests.find((r) => r.url.includes('/ilink/bot/sendmessage'));
  assert.ok(sendReq, 'gateway sendmessage called');
  assert.ok((sendReq!.body as string).includes('**done**'));
  assert.ok(v.files.get('Wechatian/2026-08-27.md')?.includes('**done**'), 'send recorded in daily note');
});

test('outbox: failure keeps the file with a categorized hint', async () => {
  const { v, transport, flush } = outboxFixture();
  await v.adapter.write('Wechatian/outbox/hello.md', 'retry me');
  transport.response = { status: 200, body: JSON.stringify({ ret: -1, errmsg: 'no permission' }) };
  applyLanguage('zh');
  const n = await flush();
  assert.equal(n, 0);
  const content = v.files.get('Wechatian/outbox/hello.md')!;
  assert.ok(content.startsWith('retry me'));
  assert.ok(content.includes('Wechatian send failed:'), 'agent-readable failure marker preserved');
  assert.ok(content.includes('发送被拒'), 'categorized reason present');
  assert.ok(content.includes('稍等几分钟'), 'fix hint present');
});

test('outbox: unknown extension is left alone', async () => {
  const { v, flush } = outboxFixture();
  await v.adapter.write('Wechatian/outbox/thing.xyz', 'x');
  assert.equal(await flush(), 0);
  assert.equal(v.files.has('Wechatian/outbox/thing.xyz'), true);
});

test('outbox: empty .md is deleted without sending', async () => {
  const { v, transport, flush } = outboxFixture();
  await v.adapter.write('Wechatian/outbox/empty.md', '   ');
  assert.equal(await flush(), 0);
  assert.equal(v.files.has('Wechatian/outbox/empty.md'), false);
  assert.equal(transport.requests.length, 0);
});

/* ------------------------------------------------------------ agent guide */

test('agentGuideMeta parses frontmatter', () => {
  const meta = agentGuideMeta('---\nlang: tw\nrev: 2\npaths: "a|b|c"\n---\n\nbody');
  assert.equal(meta.lang, 'tw');
  assert.equal(meta.rev, '2');
  assert.equal(meta.paths, 'a|b|c');
  const empty = agentGuideMeta('no frontmatter');
  assert.equal(empty.lang, '');
});

/* ------------------------------------------------------------- settings */

test('DEFAULT_SETTINGS: autoReply defaults on', () => {
  assert.equal(DEFAULT_SETTINGS.autoReply, true);
  assert.equal(DEFAULT_SETTINGS.language, 'system');
});

/* -------------------------------------------------------------- cleanup */

test('restore default language', () => {
  applyLanguage('en');
  assert.equal(resolvedLanguage(), 'en');
});
