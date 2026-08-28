/** Node tests for article fetching: HTML -> markdown via an injected DOM parser */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { App } from 'obsidian';
import { parseHTML, type Document } from 'linkedom';
import { fetchArticle, type HtmlParser } from '../src/core/article';
import type { HttpTransport, HttpResponse } from '../src/core/http';
import { lowerHeaders } from '../src/core/http';
import { importMessage } from '../src/core/importer';
import type { InboundMessage } from '../src/core/types';

// Node has no window/article scheduling shims needed here
(globalThis as { window?: unknown }).window = globalThis;

const parseHtml: HtmlParser = (html: string) => parseHTML(html).document as unknown as Document;

/** Transport that serves a fixed HTML page for the article URL and small PNGs for images */
function articleTransport(html: string, imgStatus = 200): HttpTransport {
  return {
    async get(url: string): Promise<HttpResponse> {
      if (url.includes('/img/')) {
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
        return { status: imgStatus, body: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer, headers: lowerHeaders({}) };
      }
      const body = new TextEncoder().encode(html);
      return { status: 200, body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, headers: lowerHeaders({}) };
    },
    async post(): Promise<HttpResponse> {
      throw new Error('not used');
    },
  };
}

const WECHAT_PAGE = `<html><head>
<title>fallback title</title>
<meta property="og:title" content="测试文章标题">
<meta property="og:description" content="文章摘要">
</head><body>
<span id="js_name">测试公众号</span>
<div id="js_content">
<h2>小节</h2>
<p>这是正文,<strong>加粗</strong> 和 <em>斜体</em>。</p>
<img data-src="https://img.example/img/0.png">
<ul><li>第一</li><li>第二</li></ul>
</div>
</body></html>`;

test('fetchArticle: WeChat page -> title/description/account/markdown/images', async () => {
  const info = await fetchArticle(articleTransport(WECHAT_PAGE), 'https://mp.weixin.qq.com/s/xyz', parseHtml);
  assert.ok(info);
  assert.equal(info!.title, '测试文章标题');
  assert.equal(info!.description, '文章摘要');
  assert.equal(info!.account, '测试公众号');
  assert.ok(info!.markdown.includes('# 小节'));
  assert.ok(info!.markdown.includes('**加粗**'));
  assert.ok(info!.markdown.includes('*斜体*'));
  assert.ok(info!.markdown.includes('- 第一'));
  // the image placeholder was resolved to the downloaded local embed
  assert.ok(info!.markdown.includes('![[https://img.example/img/0.png]]') === false, 'no unresolved img:0 placeholder');
  assert.equal(info!.images.length, 1);
  assert.ok(info!.images[0].data, 'image bytes downloaded');
  assert.equal(info!.images[0].ext, 'png');
});

test('fetchArticle: generic page without og tags uses <title> and body', async () => {
  const page = '<html><head><title>Plain Page</title></head><body><p>only body text</p></body></html>';
  const info = await fetchArticle(articleTransport(page), 'https://example.com/post', parseHtml);
  assert.ok(info);
  assert.equal(info!.title, 'Plain Page');
  assert.equal(info!.account, '', 'no #js_name -> not grouped');
  assert.ok(info!.markdown.includes('only body text'));
});

test('fetchArticle: no title at all -> rejects (raw link stays in the note)', async () => {
  const page = '<html><body><p>anonymous</p></body></html>';
  await assert.rejects(fetchArticle(articleTransport(page), 'https://example.com/x', parseHtml), /no title/);
});

test('fetchArticle: non-200 response rejects with the status as the reason', async () => {
  const failing: HttpTransport = {
    async get(): Promise<HttpResponse> {
      return { status: 503, body: new ArrayBuffer(0), headers: lowerHeaders({}) };
    },
    async post(): Promise<HttpResponse> {
      throw new Error('not used');
    },
  };
  await assert.rejects(fetchArticle(failing, 'https://example.com/x', parseHtml), /http 503/);
});

test('fetchArticle: image download failure keeps the placeholder with null data', async () => {
  const info = await fetchArticle(articleTransport(WECHAT_PAGE, 404), 'https://mp.weixin.qq.com/s/xyz', parseHtml);
  assert.ok(info);
  // fetchArticle leaves the placeholder untouched; the caller (importer) swaps
  // it for a remote markdown link when img.data is null
  assert.ok(info!.markdown.includes('![[img:0]]'), 'placeholder preserved for the caller');
  assert.equal(info!.images[0].data, null);
});

/* ---------------------------------------------- importMessage: overwrite */

/** In-memory fake of the Obsidian vault adapter subset the importer uses */
class Vault {
  files = new Map<string, string>();
  bins = new Map<string, Uint8Array>();
  adapter = {
    exists: async (p: string) => this.files.has(p) || this.bins.has(p),
    read: async (p: string) => {
      if (!this.files.has(p)) throw new Error(`ENOENT: ${p}`);
      return this.files.get(p)!;
    },
    append: async (p: string, c: string) => this.files.set(p, (this.files.get(p) ?? '') + c),
    write: async (p: string, c: string) => this.files.set(p, c),
    writeBinary: async (p: string, c: ArrayBuffer) => this.bins.set(p, new Uint8Array(c)),
    remove: async (p: string) => {
      this.files.delete(p);
      this.bins.delete(p);
    },
  };
  app = {
    vault: {
      adapter: this.adapter,
      create: async (p: string, c: string) => this.adapter.write(p, c),
      createFolder: async () => undefined,
    },
  } as unknown as App;
}

const ARTICLE_MSG = (text: string, id: string): InboundMessage => ({
  from: 'user123',
  messageId: id,
  timeMs: new Date(2026, 7, 27, 14, 30).getTime(),
  text,
  attachments: [],
  attachmentFailures: [],
  raw: {},
});

const IMPORT_OPTS = {
  inboxFolder: 'Wechatian',
  attachmentFolder: 'Wechatian/attachments',
  articleFolder: 'Wechatian/articles',
  fetchArticles: true,
  groupArticlesByAccount: false,
  parseHtml,
};

test('importMessage: article note keeps the date prefix, daily note links it in 《》', async () => {
  const v = new Vault();
  const r = await importMessage(v.app, articleTransport(WECHAT_PAGE), ARTICLE_MSG('https://mp.weixin.qq.com/s/xyz', 'm0'), IMPORT_OPTS);
  assert.equal(r.articleAssets[0].note, 'Wechatian/articles/2026-08-27 测试文章标题.md', 'date prefix on the note name');
  const daily = v.files.get('Wechatian/2026-08-27.md')!;
  assert.ok(daily.includes('[[Wechatian/articles/2026-08-27 测试文章标题|《测试文章标题》]]'), 'article linked with 《》 in the daily note');
});

test('importMessage: re-sending an article link overwrites the existing note', async () => {
  const v = new Vault();
  const url = 'https://mp.weixin.qq.com/s/xyz';

  const first = await importMessage(v.app, articleTransport(WECHAT_PAGE), ARTICLE_MSG(url, 'm1'), IMPORT_OPTS);
  assert.equal(first.articleAssets.length, 1);
  const notePath = first.articleAssets[0].note;
  const firstImages = [...v.bins.keys()];
  assert.ok(firstImages.some((p) => p.includes('assets')), 'first import saved an image');
  assert.ok(v.files.get(notePath)!.includes('这是正文'));

  // re-send the same link: the stale note and its images are replaced, not skipped
  const second = await importMessage(v.app, articleTransport(WECHAT_PAGE), ARTICLE_MSG(url, 'm2'), IMPORT_OPTS);
  assert.equal(second.articleAssets.length, 1, 'duplicate is recorded again, not silently skipped');
  assert.equal(second.articleAssets[0].note, notePath, 'same note path is reused');
  assert.ok(v.files.get(notePath)!.includes('这是正文'), 'note content rewritten');
  // no orphaned image files accumulate from the first import
  assert.deepEqual([...v.bins.keys()].sort(), firstImages.sort(), 'old images replaced one-for-one');
});
