/** Node tests for article fetching: HTML -> markdown via an injected DOM parser */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML, type Document } from 'linkedom';
import { fetchArticle, type HtmlParser } from '../src/core/article';
import type { HttpTransport, HttpResponse } from '../src/core/http';
import { lowerHeaders } from '../src/core/http';

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
