/**
 * Node unit tests, batch 2: ilink gateway protocol (poll/decrypt, sendText
 * chunking, sendMedia upload chain) + outbox media sending.
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import type { App } from 'obsidian';
import type { HttpTransport, HttpResponse } from '../src/core/http';
import { lowerHeaders, bodyTextAuto } from '../src/core/http';
import { encryptEcb, decryptEcb } from '../src/core/crypto';
import {
  IlinkClient,
  extractText,
  splitByCodePoints,
  buildMediaItem,
  buildCdnUploadUrl,
  isVideoExt,
  MAX_DOWNLOAD_BYTES,
  MAX_UPLOAD_BYTES,
} from '../src/core/ilink';
import {
  ITEM_FILE,
  ITEM_IMAGE,
  ITEM_TEXT,
  ITEM_VIDEO,
  ITEM_VOICE,
  MSG_TYPE_BOT,
  MSG_TYPE_USER,
} from '../src/core/types';
import type { OutboundAttachment } from '../src/core/types';
import { Outbox } from '../src/outbox';
import { StateStore } from '../src/core/store';
import { applyLanguage } from '../src/i18n';

// Node has no `window`; ilink/store schedule via window.setTimeout
(globalThis as { window?: unknown }).window = globalThis;

/* ------------------------------------------------------------ transport */

interface ScriptedResponse {
  status?: number;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
}

/** URL-pattern routed transport: each match consumes its queued responses in order */
class ScriptableTransport implements HttpTransport {
  requests: Array<{ method: string; url: string; body?: string | ArrayBuffer }> = [];
  private routes: Array<{ match: RegExp; responses: ScriptedResponse[] }> = [];
  defaultResponse: ScriptedResponse = { status: 200, body: '{}' };

  on(match: RegExp, ...responses: ScriptedResponse[]): this {
    this.routes.push({ match, responses });
    return this;
  }

  private respond(url: string): ScriptedResponse {
    for (const r of this.routes) {
      if (r.match.test(url) && r.responses.length) return r.responses.shift()!;
    }
    return this.defaultResponse;
  }

  private toHttp(r: ScriptedResponse): HttpResponse {
    const b = r.body ?? '';
    const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : b;
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return { status: r.status ?? 200, body: ab, headers: lowerHeaders(r.headers ?? {}) };
  }

  async get(url: string, _headers: Record<string, string>, _timeoutMs: number): Promise<HttpResponse> {
    this.requests.push({ method: 'GET', url });
    return this.toHttp(this.respond(url));
  }
  async post(url: string, _headers: Record<string, string>, body: string | ArrayBuffer, _timeoutMs: number): Promise<HttpResponse> {
    this.requests.push({ method: 'POST', url, body });
    return this.toHttp(this.respond(url));
  }
}

const client = (tr: HttpTransport) =>
  new IlinkClient(tr, { baseUrl: 'https://gw.example/', cdnBase: 'https://cdn.example' }, 'bot-token');

const jsonBody = (r: { body?: string | ArrayBuffer }): Record<string, unknown> =>
  JSON.parse(Buffer.from(r.body as ArrayBuffer).toString('utf8'));

/* ------------------------------------------------------------ extractText */

test('extractText: plain / quote / media-quote / voice', () => {
  assert.equal(extractText([{ type: ITEM_TEXT, text_item: { text: '  hi  ' } }]), 'hi');
  assert.equal(
    extractText([
      {
        type: ITEM_TEXT,
        text_item: { text: 'reply' },
        ref_msg: { title: 'orig title', message_item: { type: ITEM_TEXT, text_item: { text: 'orig body' } } },
      },
    ]),
    '[Quote: orig title | orig body]\nreply',
  );
  // quoting media keeps just the reply text
  assert.equal(
    extractText([
      { type: ITEM_TEXT, text_item: { text: 'nice pic' }, ref_msg: { message_item: { type: ITEM_IMAGE } } },
    ]),
    'nice pic',
  );
  assert.equal(extractText([{ type: ITEM_VOICE, voice_item: { text: 'transcribed voice' } }]), 'transcribed voice');
  assert.equal(extractText([]), '');
});

test('splitByCodePoints keeps emoji intact', () => {
  assert.deepEqual(splitByCodePoints('😀😀😀', 2), ['😀😀', '😀']);
  assert.deepEqual(splitByCodePoints('abc', 5), ['abc']);
});

/* ------------------------------------------------------------ pure helpers */

test('buildCdnUploadUrl / isVideoExt', () => {
  assert.equal(
    buildCdnUploadUrl('https://cdn.example/', 'p a', 'fk'),
    'https://cdn.example/upload?encrypted_query_param=p%20a&filekey=fk',
  );
  assert.equal(isVideoExt('mp4'), true);
  assert.equal(isVideoExt('MP4'), true);
  assert.equal(isVideoExt('jpg'), false);
});

test('buildMediaItem per kind', () => {
  const ref = { downloadParam: 'dl', aesKey: Buffer.from('0123456789abcdef'), cipherSize: 32, rawSize: 20 };
  const img = buildMediaItem({ kind: 'image', name: 'a.jpg', data: new Uint8Array(20) }, ref);
  assert.equal(img.type, ITEM_IMAGE);
  assert.equal(img.image_item?.mid_size, 32);
  assert.equal(img.image_item?.media?.encrypt_query_param, 'dl');
  // aes_key in sendmessage is base64(hex) — NOT raw base64
  assert.equal(img.image_item?.media?.aes_key, Buffer.from('30313233343536373839616263646566', 'utf8').toString('base64'));
  const vid = buildMediaItem({ kind: 'video', name: 'v.mp4', data: new Uint8Array(20) }, ref);
  assert.equal(vid.type, ITEM_VIDEO);
  assert.equal(vid.video_item?.video_size, 32);
  const file = buildMediaItem({ kind: 'file', name: 'doc.pdf', data: new Uint8Array(20) }, ref);
  assert.equal(file.type, ITEM_FILE);
  assert.equal(file.file_item?.file_name, 'doc.pdf');
  assert.equal(file.file_item?.len, '20');
});

/* ------------------------------------------------------------------ poll */

test('poll: text message parsed with from/id/time/text', async () => {
  const tr = new ScriptableTransport().on(/getupdates/, {
    body: JSON.stringify({
      ret: 0,
      errcode: 0,
      get_updates_buf: 'cursor-2',
      msgs: [
        {
          message_type: MSG_TYPE_USER,
          from_user_id: 'alice',
          message_id: 42,
          create_time_ms: 1700000000000,
          context_token: 'ct',
          item_list: [{ type: ITEM_TEXT, text_item: { text: 'hello bot' } }],
        },
      ],
    }),
  });
  const r = await client(tr).poll('cursor-1');
  assert.equal(r.sessionExpired, false);
  assert.equal(r.cursor, 'cursor-2');
  assert.equal(r.messages.length, 1);
  const m = r.messages[0];
  assert.equal(m.from, 'alice');
  assert.equal(m.messageId, '42');
  assert.equal(m.timeMs, 1700000000000);
  assert.equal(m.text, 'hello bot');
});

test('poll: bot messages and empty messages are filtered out', async () => {
  const tr = new ScriptableTransport().on(/getupdates/, {
    body: JSON.stringify({
      ret: 0,
      msgs: [
        { message_type: MSG_TYPE_BOT, from_user_id: 'bot', item_list: [{ type: ITEM_TEXT, text_item: { text: 'echo' } }] },
        { message_type: MSG_TYPE_USER, from_user_id: 'alice', item_list: [] }, // no text, no media
        { message_type: MSG_TYPE_USER, from_user_id: '', item_list: [{ type: ITEM_TEXT, text_item: { text: 'x' } }] },
      ],
    }),
  });
  const r = await client(tr).poll('');
  assert.equal(r.messages.length, 0);
});

test('poll: session expired errcode', async () => {
  const tr = new ScriptableTransport().on(/getupdates/, { body: JSON.stringify({ ret: -1, errcode: -14 }) });
  const r = await client(tr).poll('');
  assert.equal(r.sessionExpired, true);
});

test('poll: gateway http error surfaces as error string', async () => {
  const tr = new ScriptableTransport().on(/getupdates/, { status: 500, body: 'boom' });
  const r = await client(tr).poll('');
  assert.ok(r.error?.includes('http 500'));
});

test('poll: image attachment is downloaded and AES-decrypted', async () => {
  const key = Buffer.from('0123456789abcdef');
  const plain = Buffer.from('secret image bytes');
  const cipher = encryptEcb(plain, key);
  const tr = new ScriptableTransport()
    .on(/getupdates/, {
      body: JSON.stringify({
        ret: 0,
        msgs: [
          {
            message_type: MSG_TYPE_USER,
            from_user_id: 'alice',
            message_id: 7,
            create_time_ms: 1700000000000,
            item_list: [
              {
                type: ITEM_IMAGE,
                image_item: { media: { encrypt_query_param: 'enc-param', aes_key: key.toString('base64') } },
              },
            ],
          },
        ],
      }),
    })
    .on(/cdn\.example\/download/, { body: cipher });
  const r = await client(tr).poll('');
  assert.equal(r.messages.length, 1);
  const att = r.messages[0].attachments[0];
  assert.equal(att.kind, 'image');
  assert.equal(Buffer.from(att.data).toString(), 'secret image bytes');
  assert.equal(r.messages[0].text, ''); // media-only message still counts
});

test('poll: failed media download is recorded with a reason, not silently dropped', async () => {
  const key = Buffer.from('0123456789abcdef');
  const tr = new ScriptableTransport()
    .on(/getupdates/, {
      body: JSON.stringify({
        ret: 0,
        msgs: [
          {
            message_type: MSG_TYPE_USER,
            from_user_id: 'alice',
            message_id: 8,
            create_time_ms: 1700000000000,
            item_list: [
              {
                type: ITEM_IMAGE,
                image_item: { media: { encrypt_query_param: 'enc-param', aes_key: key.toString('base64') } },
              },
            ],
          },
        ],
      }),
    })
    .on(/cdn\.example\/download/, { status: 503, body: 'cdn down' });
  const r = await client(tr).poll('');
  assert.equal(r.messages.length, 1, 'media-only message survives when the download fails');
  assert.equal(r.messages[0].attachments.length, 0);
  const f = r.messages[0].attachmentFailures[0];
  assert.equal(f.kind, 'image');
  assert.ok(f.reason.includes('503'));
});

test('poll: oversized inbound media is rejected without being saved', async () => {
  const key = Buffer.from('0123456789abcdef');
  const tr = new ScriptableTransport()
    .on(/getupdates/, {
      body: JSON.stringify({
        ret: 0,
        msgs: [
          {
            message_type: MSG_TYPE_USER,
            from_user_id: 'alice',
            message_id: 9,
            create_time_ms: 1700000000000,
            item_list: [
              {
                type: ITEM_IMAGE,
                image_item: { media: { encrypt_query_param: 'enc-param', aes_key: key.toString('base64') } },
              },
            ],
          },
        ],
      }),
    })
    .on(/cdn\.example\/download/, { body: new Uint8Array(MAX_DOWNLOAD_BYTES + 1) });
  const r = await client(tr).poll('');
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].attachments.length, 0);
  assert.ok(r.messages[0].attachmentFailures[0].reason.includes('too large'));
});

/* -------------------------------------------------------------- typing */

test('typing: getConfig -> sendtyping(status=1) -> sendtyping(status=2)', async () => {
  const tr = new ScriptableTransport()
    .on(/getconfig/, { body: JSON.stringify({ typing_ticket: 'tk-123' }) })
    .on(/sendtyping/, { body: JSON.stringify({}) });
  const c = client(tr);
  const cfg = await c.getConfig('alice', 'ctx');
  assert.equal(cfg.typingTicket, 'tk-123');
  assert.equal(await c.sendTyping('alice', cfg.typingTicket, true), true);
  assert.equal(await c.sendTyping('alice', cfg.typingTicket, false), true);

  const cfgReq = tr.requests.find((r) => r.url.includes('getconfig'))!;
  const cfgBody = jsonBody(cfgReq) as { ilink_user_id?: string; context_token?: string };
  assert.equal(cfgBody.ilink_user_id, 'alice');
  assert.equal(cfgBody.context_token, 'ctx');
  const typings = tr.requests.filter((r) => r.url.includes('sendtyping'));
  assert.equal(typings.length, 2);
  assert.equal((jsonBody(typings[0]) as { status?: number }).status, 1);
  assert.equal((jsonBody(typings[1]) as { status?: number }).status, 2);
  for (const r of typings) {
    assert.equal((jsonBody(r) as { typing_ticket?: string }).typing_ticket, 'tk-123');
  }
});

test('typing: failures degrade silently (no ticket -> no call; gateway error -> false)', async () => {
  const tr = new ScriptableTransport().on(/getconfig/, { status: 503, body: 'down' });
  const c = client(tr);
  const cfg = await c.getConfig('alice', 'ctx');
  assert.equal(cfg.typingTicket, '', 'getconfig failure yields no ticket, not a throw');
  assert.equal(await c.sendTyping('alice', '', true), false, 'empty ticket is a local no-op');
  assert.equal(tr.requests.filter((r) => r.url.includes('sendtyping')).length, 0);

  const tr2 = new ScriptableTransport().on(/sendtyping/, { status: 500, body: 'oops' });
  assert.equal(await client(tr2).sendTyping('alice', 'tk', true), false, 'gateway error reported as false');
});

/* -------------------------------------------------------------- sendText */

test('sendText: chunked into multiple gateway calls', async () => {
  const tr = new ScriptableTransport().on(/sendmessage/, { body: '{"ret":0}' }, { body: '{"ret":0}' });
  const text = 'a'.repeat(3800 * 2); // exactly two chunks
  const res = await client(tr).sendText('alice', text, 'ct');
  assert.equal(res.ok, true);
  const sends = tr.requests.filter((r) => r.url.includes('sendmessage'));
  assert.equal(sends.length, 2);
  const first = (jsonBody(sends[0]).msg as { item_list: Array<{ text_item: { text: string } }> }).item_list[0].text_item.text;
  assert.equal(first.length, 3800);
});

test('sendText: no credential -> local failure without a gateway call', async () => {
  const tr = new ScriptableTransport();
  const res = await client(tr).sendText('alice', 'hi', '   ');
  assert.equal(res.ok, false);
  assert.ok(res.errmsg.includes('context_token'));
  assert.equal(tr.requests.length, 0);
});

/* -------------------------------------------------------------- sendMedia */

function mediaScript() {
  return new ScriptableTransport()
    .on(/getuploadurl/, { body: JSON.stringify({ ret: 0, upload_full_url: 'https://cdn.example/upload/x' }) })
    .on(/cdn\.example\/upload/, { status: 200, headers: { 'x-encrypted-param': 'DL-PARAM' } })
    .on(/sendmessage/, { body: JSON.stringify({ ret: 0 }) });
}

test('sendMedia: full chain encrypt -> getuploadurl -> CDN -> sendmessage', async () => {
  const tr = mediaScript();
  const data = Buffer.from('hello media — 你好');
  const res = await client(tr).sendMedia('alice', { kind: 'image', name: 'pic.jpg', data: new Uint8Array(data) }, 'ct');
  assert.equal(res.ok, true);

  const [uploadUrlReq, cdnReq, sendReq] = tr.requests;
  assert.ok(uploadUrlReq.url.includes('getuploadurl'));
  assert.ok(cdnReq.url.startsWith('https://cdn.example/upload/x'));
  assert.ok(sendReq.url.includes('sendmessage'));

  // getuploadurl carries the raw size, padded cipher size, md5 and the HEX aes key
  const up = jsonBody(uploadUrlReq);
  assert.equal(up.rawsize, data.length);
  assert.equal(up.filesize, Math.ceil(data.length / 16) * 16);
  assert.equal(typeof up.filekey, 'string');
  const keyHex = up.aeskey as string;
  assert.match(keyHex, /^[0-9a-f]{32}$/);

  // CDN body is AES-ECB ciphertext of the original data
  const key = Buffer.from(keyHex, 'hex');
  const decrypted = decryptEcb(Buffer.from(cdnReq.body as ArrayBuffer), key);
  assert.deepEqual(decrypted, data);

  // sendmessage references the CDN download param + base64(hex) key
  const msg = jsonBody(sendReq).msg as { item_list: Array<Record<string, unknown>> };
  const media = (msg.item_list[0].image_item as { media: Record<string, unknown> }).media;
  assert.equal(media.encrypt_query_param, 'DL-PARAM');
  assert.equal(media.aes_key, Buffer.from(keyHex, 'utf8').toString('base64'));
});

test('sendMedia: upload_param fallback builds the CDN url', async () => {
  const tr = new ScriptableTransport()
    .on(/getuploadurl/, { body: JSON.stringify({ ret: 0, upload_param: 'PARAM' }) })
    .on(/cdn\.example\/upload/, { status: 200, headers: { 'x-encrypted-param': 'DL' } })
    .on(/sendmessage/, { body: '{"ret":0}' });
  const res = await client(tr).sendMedia('alice', { kind: 'file', name: 'a.pdf', data: new Uint8Array([1, 2, 3]) }, 'ct');
  assert.equal(res.ok, true);
  const cdnReq = tr.requests[1];
  assert.ok(cdnReq.url.includes('encrypted_query_param=PARAM'), `got ${cdnReq.url}`);
});

test('sendMedia: CDN 5xx is retried up to 3 times', async () => {
  const tr = new ScriptableTransport()
    .on(/getuploadurl/, { body: JSON.stringify({ ret: 0, upload_full_url: 'https://cdn.example/upload/x' }) })
    .on(/cdn\.example\/upload/, { status: 503 }, { status: 503 }, { status: 200, headers: { 'x-encrypted-param': 'DL' } })
    .on(/sendmessage/, { body: '{"ret":0}' });
  const res = await client(tr).sendMedia('alice', { kind: 'image', name: 'p.jpg', data: new Uint8Array([9]) }, 'ct');
  assert.equal(res.ok, true);
  assert.equal(tr.requests.filter((r) => r.url.includes('cdn.example/upload')).length, 3);
});

test('sendMedia: CDN 4xx fails fast with the CDN error message', async () => {
  const tr = new ScriptableTransport()
    .on(/getuploadurl/, { body: JSON.stringify({ ret: 0, upload_full_url: 'https://cdn.example/upload/x' }) })
    .on(/cdn\.example\/upload/, { status: 400, headers: { 'x-error-message': 'bad filekey' } });
  const res = await client(tr).sendMedia('alice', { kind: 'image', name: 'p.jpg', data: new Uint8Array([9]) }, 'ct');
  assert.equal(res.ok, false);
  assert.ok(res.errmsg.includes('bad filekey'));
});

test('sendMedia: empty / oversized / no credential are rejected locally', async () => {
  const tr = mediaScript();
  const c = client(tr);
  const empty = await c.sendMedia('alice', { kind: 'file', name: 'x', data: new Uint8Array(0) }, 'ct');
  assert.ok(empty.errmsg.includes('empty'));
  const big = await c.sendMedia('alice', { kind: 'file', name: 'x', data: new Uint8Array(MAX_UPLOAD_BYTES + 1) }, 'ct');
  assert.ok(big.errmsg.includes('too large'));
  const noTok = await c.sendMedia('alice', { kind: 'file', name: 'x', data: new Uint8Array(1) }, '  ');
  assert.ok(noTok.errmsg.includes('context_token'));
  assert.equal(tr.requests.length, 0, 'no gateway call for locally rejected sends');
});

/* ------------------------------------------------------------- outbox media */

function outboxMediaFixture() {
  const files = new Map<string, string>();
  const bins = new Map<string, Uint8Array>();
  const folders = new Set<string>();
  const adapter = {
    exists: async (p: string) =>
      files.has(p) || bins.has(p) || folders.has(p) ||
      [...files.keys(), ...bins.keys()].some((f) => f.startsWith(`${p}/`)),
    read: async (p: string) => {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
      return files.get(p)!;
    },
    readBinary: async (p: string) => {
      const b = bins.get(p);
      if (!b) throw new Error(`ENOENT: ${p}`);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    write: async (p: string, c: string) => void files.set(p, c),
    writeBinary: async (p: string, c: ArrayBuffer) => void bins.set(p, new Uint8Array(c)),
    remove: async (p: string) => void (files.delete(p), bins.delete(p)),
    list: async (p: string) => ({ files: [...files.keys(), ...bins.keys()].filter((f) => f.startsWith(`${p}/`)), folders: [] }),
  };
  const app = {
    vault: {
      adapter,
      create: async (p: string, c: string) => adapter.write(p, c),
      createFolder: async (p: string) => void folders.add(p),
      getAbstractFileByPath: () => null,
    },
  } as unknown as App;
  const store = new StateStore(app, 'plugin/state.json');
  store.update((s) => {
    s.scannedUser = 'user123';
    s.contextTokens['user123'] = 'tok-1';
  });
  return { app, adapter, files, bins, store };
}

test('outbox: image file -> sendMedia chain, copy kept, file deleted', async () => {
  const { app, adapter, files, bins, store } = outboxMediaFixture();
  const tr = mediaScript();
  const outbox = new Outbox(app);
  const data = Buffer.from('fake-jpeg');
  await adapter.writeBinary('Wechatian/outbox/pic.jpg', new Uint8Array(data).buffer as ArrayBuffer);

  const n = await outbox.flush(new IlinkClient(tr, { baseUrl: 'https://gw.example', cdnBase: 'https://cdn.example' }, 'bot'), store, 'Wechatian/outbox', 'Wechatian', 'Wechatian/attachments');
  assert.equal(n, 1);
  assert.equal(bins.has('Wechatian/outbox/pic.jpg'), false, 'outbox file deleted after success');

  // a copy is kept for the daily note to link
  const copy = [...bins.keys()].find((p) => p.includes('_sent_pic.jpg'));
  assert.ok(copy, `copy saved, bins: ${[...bins.keys()]}`);

  // recorded in the daily note as a sent embed
  const daily = [...files.keys()].find((f) => /Wechatian\/\d{4}-\d{2}-\d{2}\.md$/.test(f));
  assert.ok(daily, 'daily note written');
  assert.ok(files.get(daily!)!.includes(`![[${copy}]]`), 'note embeds the copy');

  // gateway saw an image item
  const sendReq = tr.requests.find((r) => r.url.includes('sendmessage'))!;
  assert.ok(JSON.stringify(jsonBody(sendReq)).includes('image_item'));
});

test('outbox: media failure keeps the file with a categorized sidecar', async () => {
  applyLanguage('zh');
  const { app, adapter, files, bins, store } = outboxMediaFixture();
  const tr = new ScriptableTransport()
    .on(/getuploadurl/, { body: JSON.stringify({ ret: 0, upload_full_url: 'https://cdn.example/upload/x' }) })
    .on(/cdn\.example\/upload/, { status: 200, headers: { 'x-encrypted-param': 'DL' } })
    .on(/sendmessage/, { body: JSON.stringify({ ret: -1, errmsg: 'no permission' }) });
  const outbox = new Outbox(app);
  await adapter.writeBinary('Wechatian/outbox/pic.png', new Uint8Array([1, 2]).buffer as ArrayBuffer);

  const n = await outbox.flush(new IlinkClient(tr, { baseUrl: 'https://gw.example', cdnBase: 'https://cdn.example' }, 'bot'), store, 'Wechatian/outbox', 'Wechatian', 'Wechatian/attachments');
  assert.equal(n, 0);
  assert.equal(bins.has('Wechatian/outbox/pic.png'), true, 'file kept for retry');
  const sidecar = [...files.keys()].find((f) => f.endsWith('.wechatian-failed.md'));
  assert.ok(sidecar, 'failure sidecar written');
  assert.ok(files.get(sidecar!)!.includes('发送被拒'), 'categorized reason');
  assert.ok(files.get(sidecar!)!.includes('稍等几分钟'), 'fix hint');
});

/* --------------------------------------------------------------- http util */

test('bodyTextAuto: transparent gunzip', async () => {
  const { gzipSync } = await import('node:zlib');
  const gz = gzipSync(Buffer.from('compressed hello'));
  const r: HttpResponse = { status: 200, body: gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer, headers: {} };
  assert.equal(await bodyTextAuto(r), 'compressed hello');
  const plain: HttpResponse = { status: 200, body: new TextEncoder().encode('raw').buffer as ArrayBuffer, headers: {} };
  assert.equal(await bodyTextAuto(plain), 'raw');
});

/* ------------------------------------------------------------------- dedup */

/** Store + fake adapter without the outbox fixtures (the store only needs read/write/exists) */
function storeFixture() {
  const files = new Map<string, string>();
  let writes = 0;
  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
      return files.get(p)!;
    },
    write: async (p: string, c: string) => {
      writes++;
      files.set(p, c);
    },
  };
  const app = { vault: { adapter } } as unknown as App;
  return { app, files, writeCount: () => writes };
}

test('store dedup: seen() deduplicates, trims at the keep limit and keeps trimming consistent', async () => {
  const { app, files } = storeFixture();
  const store = new StateStore(app, 'plugin/state.json');
  assert.equal(store.seen('k1'), false);
  assert.equal(store.seen('k1'), true, 'duplicate key is rejected');

  // push past the 2000-entry trim boundary
  for (let i = 0; i < 2005; i++) assert.equal(store.seen(`m${i}`), false);
  await store.saveNow();
  const saved = JSON.parse(files.get('plugin/state.json')!) as { dedup: string[] };
  assert.equal(saved.dedup.length, 2000);
  // the trimmed-out oldest keys are no longer deduplicated; kept keys still are
  assert.equal(store.seen('m0'), false, 'oldest key fell out of the ring');
  assert.equal(store.seen('m2004'), true, 'recent key still deduplicated after trim');

  // the trimmed ring survives a reload through init()
  const store2 = new StateStore(app, 'plugin/state.json');
  await store2.init();
  assert.equal(store2.seen('m2004'), true, 'dedup index rebuilt from disk');
  assert.equal(store2.seen('m0'), false);
});

test('store saveNow: unchanged content is not rewritten (iCloud conflict reduction)', async () => {
  const { app, writeCount } = storeFixture();
  const store = new StateStore(app, 'plugin/state.json');
  store.update((s) => {
    s.scannedUser = 'user123';
  });
  await store.saveNow();
  assert.equal(writeCount(), 1);
  // the poll loop calls saveNow() every round; idle rounds must not write
  await store.saveNow();
  await store.saveNow();
  assert.equal(writeCount(), 1, 'unchanged state produces no further disk writes');
  // a real change writes again
  store.update((s) => {
    s.cursor = 'c2';
  });
  await store.saveNow();
  assert.equal(writeCount(), 2);
});

test('store init: first saveNow after load is a no-op when nothing changed', async () => {
  const { app, files, writeCount } = storeFixture();
  const store = new StateStore(app, 'plugin/state.json');
  store.update((s) => {
    s.scannedUser = 'user123';
    s.cursor = 'c1';
  });
  await store.saveNow();
  assert.equal(writeCount(), 1);

  // a fresh instance loads the same content; saveNow must not rewrite the file
  const store2 = new StateStore(app, 'plugin/state.json');
  await store2.init();
  const content = files.get('plugin/state.json')!;
  await store2.saveNow();
  assert.equal(writeCount(), 1, 'reload does not force a rewrite');
  assert.equal(files.get('plugin/state.json'), content);
});

test('store init: legacy quotaTimes/lastPollAt are dropped and the cleaned state persists', async () => {
  const { app, files } = storeFixture();
  // state.json written by an older version carries fields that no longer exist
  files.set('plugin/state.json', JSON.stringify({ scannedUser: 'u', quotaTimes: [1, 2], lastPollAt: 42, cursor: 'c' }));
  const store = new StateStore(app, 'plugin/state.json');
  await store.init();
  assert.equal(store.get().scannedUser, 'u');
  assert.equal(store.get().cursor, 'c');
  await store.saveNow();
  const saved = JSON.parse(files.get('plugin/state.json')!) as Record<string, unknown>;
  assert.ok(!('quotaTimes' in saved), 'legacy quotaTimes removed on save');
  assert.ok(!('lastPollAt' in saved), 'legacy lastPollAt removed on save');
});

test('store: fresh state carries an empty typingTickets cache', async () => {
  const { app } = storeFixture();
  const store = new StateStore(app, 'plugin/state.json');
  assert.deepEqual(store.get().typingTickets, {});
  store.update((s) => {
    s.typingTickets['alice'] = { ticket: 'tk', at: 1000 };
  });
  assert.equal(store.get().typingTickets['alice'].ticket, 'tk');
});
