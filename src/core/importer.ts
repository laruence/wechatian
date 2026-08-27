/** Import messages into the vault: daily conversation note + attachment storage + article notes */
import type { App } from 'obsidian';
import { TFolder } from 'obsidian';
import type { InboundMessage } from './types';
import type { HttpTransport } from './http';
import { extractLinks, fetchArticle, type HtmlParser } from './article';
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
  articleNotes: string[];
  attachmentPaths: string[]; // vault paths of successfully saved attachments
  attachmentFailures: string[]; // names of attachments that failed to save
  linkCount: number; // links found in the message text (regardless of fetching)
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
    articleNotes: [],
    attachmentPaths: [],
    attachmentFailures: [],
    linkCount: 0,
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
      const info = await fetchArticle(transport, url, settings.parseHtml);
      if (!info) continue; // fetch failed: the raw URL stays in the body
      const title = info.title;
      // optional per-account grouping: <articleFolder>/<account>/; article images always stay
      // inside the article tree in an assets subdir (chat attachments use attachmentFolder)
      const accountDir =
        settings.groupArticlesByAccount && info.account ? `/${sanitizeFileName(info.account)}` : '';
      const notePath = `${settings.articleFolder}${accountDir}/${dayStamp(msg.timeMs)} ${sanitizeFileName(title)}.md`;
      const mediaFolder = `${settings.articleFolder}${accountDir}/assets`;
      try {
        if (!(await app.vault.adapter.exists(notePath))) {
          await ensureFolder(app, mediaFolder);
          // store downloaded images next to the other media, then resolve placeholders
          const base = `${dayStamp(msg.timeMs)}_${timeOfDay(msg.timeMs).replace(':', '')}`;
          let body = info.markdown;
          for (let i = 0; i < info.images.length; i++) {
            const img = info.images[i];
            const ph = `![[img:${i}]]`;
            if (img.data) {
              const path = `${mediaFolder}/${base}_article${i}.${img.ext}`;
              try {
                const ab = img.data.buffer.slice(
                  img.data.byteOffset,
                  img.data.byteOffset + img.data.byteLength,
                ) as ArrayBuffer;
                await app.vault.adapter.writeBinary(path, ab);
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
          result.articleNotes.push(notePath);
        }
        display = display.split(url).join(`[[${notePath.replace(/\.md$/, '')}|${title}]]`);
      } catch {
        /* a failed article note must not break the inbox entry */
      }
    }
  }
  if (display) lines.push('', ...quoteBlock(display));

  // store attachments (rendered inline, inside the quote)
  for (const att of msg.attachments) {
    let ext = att.name.includes('.') ? att.name.split('.').pop() : '';
    if (att.kind === 'image') ext = ext && ext !== 'bin' ? ext : 'jpg';
    const base = `${dayStamp(msg.timeMs)}_${timeOfDay(msg.timeMs).replace(':', '')}`;
    const path = `${settings.attachmentFolder}/${base}_${sanitizeFileName(att.name.replace(/\.[^.]+$/, '') || att.kind)}.${ext || 'bin'}`;
    try {
      // writeBinary needs an ArrayBuffer; slice out the exact region from the Uint8Array view
      const ab = att.data.buffer.slice(att.data.byteOffset, att.data.byteOffset + att.data.byteLength) as ArrayBuffer;
      await app.vault.adapter.writeBinary(path, ab);
      result.attachmentPaths.push(path);
      const embed = att.kind === 'image' ? `![[${path}]]` : `[[${path}|${att.name}]]`;
      lines.push('', ...quoteBlock(embed));
    } catch {
      result.attachmentFailures.push(att.name);
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
  const header = `---\ndate: ${dayStamp(timeMs)}\nsender: ${sender}\n---\n\n# ${t('importer.inboxTitle', { date: dayStamp(timeMs) })}\n\n`;
  const block = lines.join('\n') + '\n\n';
  try {
    const exists = await app.vault.adapter.exists(dailyPath);
    const prev = exists ? await app.vault.adapter.read(dailyPath) : header;
    await app.vault.adapter.write(dailyPath, prev + block);
    return true;
  } catch {
    return false;
  }
}

/** Record a successful outbound send in the daily conversation note (media links its attachment copy) */
export async function appendOutbound(app: App, inboxFolder: string, timeMs: number, sender: string, lines: string[]): Promise<void> {
  await appendDaily(app, inboxFolder, timeMs, sender, lines);
}
