/** Official-account/web article fetch: full body to markdown, inline images downloaded */
import type { HttpTransport } from './http';
import { bodyTextAuto } from './http';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export interface ArticleImage {
  url: string;
  ext: string;
  /** downloaded bytes; null when the download failed (the note keeps a remote link) */
  data: Uint8Array | null;
}

export interface ArticleInfo {
  url: string;
  title: string;
  description: string;
  /** official-account name from #js_name; '' for non-WeChat pages (not grouped) */
  account: string;
  /** markdown body; images appear as ![[img:N]] placeholders until the caller resolves them */
  markdown: string;
  images: ArticleImage[];
}

/** Injectable HTML parser: the plugin uses the browser DOMParser; tests inject linkedom */
export type HtmlParser = (html: string) => Document;

/** Extract links from message text */
export function extractLinks(text: string): string[] {
  const out: string[] = [];
  const re = /https?:\/\/[^\s<>"'，。、）》]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0].replace(/[.,!?;:]+$/, ''));
  }
  return out;
}

/**
 * Fetch an article and convert it to markdown. WeChat official-account pages keep
 * the body in #js_content and lazy-load images via data-src; generic pages fall
 * back to <body>. Throws an Error with a short reason on failure, so callers
 * can tell the user why (e.g. "http 503", "no title found on page").
 */
export async function fetchArticle(transport: HttpTransport, url: string, parseHtml?: HtmlParser): Promise<ArticleInfo> {
  const resp = await transport.get(
    url,
    {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      // ask for an uncompressed body; bodyTextAuto gunzips as a fallback
      'Accept-Encoding': 'identity',
    },
    20_000,
  );
  if (resp.status !== 200) throw new Error(`http ${resp.status}`);
  const html = await bodyTextAuto(resp);
  const parse = parseHtml ?? ((h: string) => new DOMParser().parseFromString(h, 'text/html'));
  const doc = parse(html);

  const title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? doc.title ?? '';
  if (!title.trim()) throw new Error('no title found on page');
  const description =
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ??
    doc.querySelector('meta[name="description"]')?.getAttribute('content') ??
    '';

  const root = doc.querySelector('#js_content') ?? doc.body;
  const images: ArticleImage[] = [];
  const markdown = normalizeBlocks(toMd(root, images));
  await downloadImages(transport, images);

  return { url, title: cleanText(title), description: cleanText(description), account: accountName(doc), markdown, images };
}

/**
 * Official-account name on a WeChat article page lives in #js_name. Generic
 * web pages are not grouped (they have no account), so there is no fallback:
 * '' means the article lands flat in the article folder.
 */
function accountName(doc: Document): string {
  return doc.querySelector('#js_name')?.textContent?.trim() ?? '';
}

/**
 * Download every collected image through a small worker pool (3 in flight).
 * The pool size is the throttle for the throttling CDN; one retry per image
 * (with a pause before the retry). Failures keep the remote link and are
 * logged so the cause shows up in the developer console.
 */
const IMAGE_CONCURRENCY = 3;

async function downloadImages(transport: HttpTransport, images: ArticleImage[]): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < images.length) {
      const img = images[next++];
      for (let attempt = 0; attempt < 2 && !img.data; attempt++) {
        if (attempt > 0) await sleep(1500);
        try {
          const resp = await transport.get(img.url, { 'User-Agent': UA }, 20_000);
          if (resp.status === 200) {
            img.data = new Uint8Array(resp.body);
          } else {
            console.warn(`wechatian: article image HTTP ${resp.status}: ${img.url}`);
          }
        } catch (e) {
          console.warn(`wechatian: article image download failed: ${String((e as Error)?.message ?? e)}`, img.url);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, images.length) }, worker));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'figure', 'figcaption', 'ul', 'ol', 'table', 'pre', 'hr',
]);

function toMd(node: Node, images: ArticleImage[]): string {
  if (node.nodeType === 3) return collapseWs(node.textContent ?? ''); // TEXT_NODE
  if (node.nodeType !== 1) return ''; // ELEMENT_NODE
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const inner = (): string => Array.from(el.childNodes).map((n) => toMd(n, images)).join('');

  switch (tag) {
    case 'img': {
      const src = el.getAttribute('data-src') ?? el.getAttribute('src') ?? '';
      if (!src || src.startsWith('data:')) return '';
      if (images.length >= 10) {
        console.warn(`wechatian: article image cap (10) reached, keeping remote link: ${src}`);
        return `![image](${src})`;
      }
      images.push({ url: src, ext: imageExt(src), data: null });
      return ` ![[img:${images.length - 1}]] `;
    }
    case 'br':
      return '\n';
    case 'strong':
    case 'b':
      return `**${inner()}**`;
    case 'em':
    case 'i':
      return `*${inner()}*`;
    case 'code':
      return `\`${(el.textContent ?? '').trim()}\``;
    case 'a': {
      const href = el.getAttribute('href') ?? '';
      const text = cleanText(inner());
      return href.startsWith('http') && text ? `[${text}](${href})` : text;
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(tag[1]);
      return `\n\n${'#'.repeat(level)} ${cleanText(inner())}\n\n`;
    }
    case 'li':
      return `\n- ${cleanText(inner())}`;
    case 'blockquote':
      return `\n\n> ${cleanText(inner())}\n\n`;
    case 'pre':
      return `\n\n\`\`\`\n${(el.textContent ?? '').trim()}\n\`\`\`\n\n`;
    case 'script':
    case 'style':
    case 'svg':
      return '';
    default:
      if (BLOCK_TAGS.has(tag)) return `\n\n${inner()}\n\n`;
      return inner();
  }
}

/** Collapse runs of blank lines and stray spaces around line breaks */
function normalizeBlocks(md: string): string {
  return md
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ');
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function imageExt(src: string): string {
  const fmt = /[?&]wx_fmt=([a-z]+)/i.exec(src)?.[1];
  if (fmt) return fmt.toLowerCase() === 'jpeg' ? 'jpg' : fmt.toLowerCase();
  const m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(src.split('/').pop() ?? '');
  const ext = m?.[1]?.toLowerCase() ?? '';
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? ext : 'jpg';
}
