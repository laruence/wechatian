/** Official-account/web article fetch: pull the HTML and extract the title and description */
import type { HttpTransport } from './http';
import { bodyText } from './http';

export interface ArticleInfo {
  url: string;
  title: string;
  description: string;
}

/** Extract links from message text */
export function extractLinks(text: string): string[] {
  const out: string[] = [];
  const re = /https?:\/\/[^\s　<>"'，。、）》]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0].replace(/[.,!?;:]+$/, ''));
  }
  return out;
}

/**
 * Fetch article metadata. WeChat official-account articles (mp.weixin.qq.com) expose
 * og:title/og:description directly. Returns null on failure; the caller falls back
 * to a plain link entry.
 */
export async function fetchArticleInfo(transport: HttpTransport, url: string): Promise<ArticleInfo | null> {
  try {
    const resp = await transport.get(
      url,
      {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      20_000,
    );
    if (resp.status !== 200) return null;
    const html = bodyText(resp);
    const title = ogTag(html, 'og:title') || titleTag(html);
    const description = ogTag(html, 'og:description') || metaTag(html, 'description');
    if (!title) return null;
    return { url, title: cleanText(title), description: cleanText(description) };
  } catch {
    return null;
  }
}

function ogTag(html: string, prop: string): string {
  const m = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i'))
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${prop}["']`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

function metaTag(html: string, name: string): string {
  const m = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

function titleTag(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? decodeEntities(m[1]) : '';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
