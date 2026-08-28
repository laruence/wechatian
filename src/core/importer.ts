/** Import messages into the vault: daily conversation note + attachment storage + article notes */
import type { App } from 'obsidian';
import { TFolder } from 'obsidian';
import type { ArticleAsset, InboundMessage } from './types';
import type { HttpTransport } from './http';
import { extractLinks, fetchArticle, type HtmlParser } from './article';
import { detectImageExt } from './crypto';
import { t } from '../i18n';

export interface ImportSettings {
  inboxFolder: string; // inbox (daily notes)
  attachmentFolder: string; // attachments
  articleFolder: string; // official-account articles
  fetchArticles: boolean;
  groupArticlesByAccount: boolean; // one subfolder per official account under articleFolder
  parseHtml?: HtmlParser; // injected in tests; the plugin uses the browser DOMParser
}

export interface ImportResult {
  appended: boolean;
  dailyNote: string; // path of the daily conversation note the entry was appended to
  articleAssets: ArticleAsset[]; // saved article notes with the directory holding their images
  /** saved attachments: media kind + vault path (the receipt names each by kind) */
  attachments: { kind: 'image' | 'video' | 'audio' | 'file'; path: string }[];
  /** failed attachments as "name (reason)" — CDN download failures and vault write failures alike */
  attachmentFailures: string[];
  linkCount: number; // links found in the message text (regardless of fetching)
  articleFailures: string[]; // short reasons for links whose article note could not be created
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function dayStamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function timeOfDay(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Replace characters that are invalid in file names */
export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, '_').trim() || 'untitled';
}

/**
 * When the target already exists (e.g. two attachments with the same
 * generated name arriving in the same second), insert _1 / _2 / ... before
 * the extension so nothing silently overwrites anything else.
 */
async function uniquePath(app: App, path: string): Promise<string> {
  if (!(await app.vault.adapter.exists(path))) return path;
  const dot = path.lastIndexOf('.');
  const stem = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : '';
  for (let i = 1; ; i++) {
    const candidate = `${stem}_${i}${ext}`;
    if (!(await app.vault.adapter.exists(candidate))) return candidate;
  }
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  if (!folder) return;
  if (await app.vault.adapter.exists(folder)) return;
  const parts = folder.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!(await app.vault.adapter.exists(cur))) {
      await app.vault.createFolder(cur);
    }
  }
  void TFolder;
}
export { ensureFolder };

export async function importMessage(
  app: App,
  transport: HttpTransport,
  msg: InboundMessage,
  settings: ImportSettings,
): Promise<ImportResult> {
  const result: ImportResult = {
    appended: false,
    dailyNote: '',
    articleAssets: [],
    attachments: [],
    attachmentFailures: msg.attachmentFailures.map((f) => `${f.name} (${f.reason})`),
    linkCount: 0,
    articleFailures: [],
  };

  await ensureFolder(app, settings.inboxFolder);
  await ensureFolder(app, settings.attachmentFolder);
  await ensureFolder(app, settings.articleFolder);

  const lines: string[] = [];
  lines.push(`**${timeOfDay(msg.timeMs)}** · ${t('importer.received')}`);

  // links -> full article notes first, so the body shows the title link instead of the raw URL
  const links = extractLinks(msg.text);
  result.linkCount = links.length;
  let display = msg.text.trim();
  if (settings.fetchArticles && links.length) {
    for (const url of links.slice(0, 5)) {
      try {
        const info = await fetchArticle(transport, url, settings.parseHtml);
        const title = info.title;
        // optional per-account grouping: <articleFolder>/<account>/; article images always stay
        // inside the article tree in an assets subdir (chat attachments use attachmentFolder)
        const accountDir =
          settings.groupArticlesByAccount && info.account ? `/${sanitizeFileName(info.account)}` : '';
        const notePath = `${settings.articleFolder}${accountDir}/${dayStamp(msg.timeMs)} ${sanitizeFileName(title)}.md`;
        const mediaFolder = `${settings.articleFolder}${accountDir}/assets`;
        if (await app.vault.adapter.exists(notePath)) {
          // re-sent link: overwrite with the freshly fetched content instead of
          // silently skipping. Delete the old note's downloaded images first so
          // re-imports don't accumulate orphans (remote ![image](url) links are
          // URLs, not vault files, and stay untouched)
          try {
            const old = await app.vault.adapter.read(notePath);
            for (const m of old.matchAll(/!\[\[([^\]|#]+)\]\]/g)) {
              if (m[1].startsWith(`${mediaFolder}/`)) {
                try {
                  await app.vault.adapter.remove(m[1]);
                } catch {
                  /* orphan cleanup is best-effort */
                }
              }
            }
            await app.vault.adapter.remove(notePath);
          } catch {
            /* overwrite is best-effort; a leftover note is cosmetic */
          }
        }
        await ensureFolder(app, mediaFolder);
        // store downloaded images next to the other media, then resolve placeholders
        const base = `${dayStamp(msg.timeMs)}_${timeOfDay(msg.timeMs).replace(':', '')}`;
        let body = info.markdown;
        let savedAssets = 0;
        for (let i = 0; i < info.images.length; i++) {
          const img = info.images[i];
          const ph = `![[img:${i}]]`;
          if (img.data) {
            const path = await uniquePath(app, `${mediaFolder}/${base}_article${i}.${img.ext}`);
            try {
              const ab = img.data.buffer.slice(
                img.data.byteOffset,
                img.data.byteOffset + img.data.byteLength,
              ) as ArrayBuffer;
              await app.vault.adapter.writeBinary(path, ab);
              savedAssets++;
              body = body.split(ph).join(`![[${path}]]`);
              continue;
            } catch {
              /* fall through to a remote link */
            }
          }
          body = body.split(ph).join(`![image](${img.url})`);
        }
        const note = [
          `# ${title}`,
          '',
          `> **${t('importer.source')}**: ${url}`,
          `> **${t('importer.imported')}**: ${new Date(msg.timeMs).toLocaleString()}`,
          `> **${t('importer.from')}**: ${msg.from}`,
          info.description ? `> **${t('importer.summary')}**: ${info.description}` : '',
          '',
          body,
          '',
        ].join('\n');
        await app.vault.create(notePath, note);
        result.articleAssets.push({ title, note: notePath, url, assetsDir: mediaFolder, assetCount: savedAssets });
        display = display.split(url).join(`[[${notePath.replace(/\.md$/, '')}|《${title}》]]`);
      } catch (e) {
        // a failed article note must not break the inbox entry, but the user
        // should learn why (e.g. http 503, no title on the page)
        result.articleFailures.push(String((e as Error)?.message ?? e));
      }
    }
  }
  if (display) lines.push('', ...quoteBlock(display));

  // store attachments (rendered inline, inside the quote)
  for (const att of msg.attachments) {
    let ext = att.name.includes('.') ? att.name.split('.').pop() : '';
    // images arrive as nameless .bin from the CDN: identify jpg/png/gif/webp by magic bytes
    if (att.kind === 'image') ext = ext && ext !== 'bin' ? ext : detectImageExt(att.data);
    const base = `${dayStamp(msg.timeMs)}_${timeOfDay(msg.timeMs).replace(':', '')}`;
    const rawPath = `${settings.attachmentFolder}/${base}_${sanitizeFileName(att.name.replace(/\.[^.]+$/, '') || att.kind)}.${ext || 'bin'}`;
    const path = await uniquePath(app, rawPath);
    try {
      // writeBinary needs an ArrayBuffer; slice out the exact region from the Uint8Array view
      const ab = att.data.buffer.slice(att.data.byteOffset, att.data.byteOffset + att.data.byteLength) as ArrayBuffer;
      await app.vault.adapter.writeBinary(path, ab);
      result.attachments.push({ kind: att.kind, path });
      // audio is embedded so transcoded voice messages render as an inline
      // player (.wav); a .silk fallback has no renderer, so it stays a link
      const embed =
        att.kind === 'image' || (att.kind === 'audio' && path.endsWith('.wav'))
          ? `![[${path}]]`
          : `[[${path}|${att.name}]]`;
      lines.push('', ...quoteBlock(embed));
    } catch (e) {
      result.attachmentFailures.push(`${att.name} (${String((e as Error)?.message ?? e)})`);
      lines.push('', ...quoteBlock(t('importer.attachFailed', { name: att.name })));
    }
  }

  // append to today's conversation note (sender goes in frontmatter so agents can look up the recipient ID)
  result.dailyNote = `${settings.inboxFolder}/${dayStamp(msg.timeMs)}.md`;
  result.appended = await appendDaily(app, settings.inboxFolder, msg.timeMs, msg.from, lines);
  return result;
}

/** Wrap a message body as a markdown quote block so entries read as distinct bubbles */
export function quoteBlock(text: string): string[] {
  return text
    .trim()
    .split('\n')
    .map((l) => `> ${l}`);
}

/** Append one block to the daily conversation note; creates it with a header when missing */
async function appendDaily(app: App, inboxFolder: string, timeMs: number, sender: string, lines: string[]): Promise<boolean> {
  const dailyPath = `${inboxFolder}/${dayStamp(timeMs)}.md`;
  const block = lines.join('\n') + '\n\n';
  try {
    if (await app.vault.adapter.exists(dailyPath)) {
      // append the new block only; rewriting the whole file would read it back
      // first, which on iCloud-synced vaults can race a stale copy and lose entries
      await app.vault.adapter.append(dailyPath, block);
    } else {
      // sender goes in frontmatter so agents can look up the recipient ID
      const header = `---\ndate: ${dayStamp(timeMs)}\nsender: ${sender}\n---\n\n# ${t('importer.inboxTitle', { date: dayStamp(timeMs) })}\n\n`;
      await app.vault.adapter.write(dailyPath, header + block);
    }
    return true;
  } catch {
    return false;
  }
}

/** Record a successful outbound send in the daily conversation note (media links its attachment copy) */
export async function appendOutbound(app: App, inboxFolder: string, timeMs: number, sender: string, lines: string[]): Promise<void> {
  await appendDaily(app, inboxFolder, timeMs, sender, lines);
}
