/** Import messages into the vault: daily inbox + attachment storage + article notes */
import type { App } from 'obsidian';
import { TFolder } from 'obsidian';
import type { InboundMessage } from './types';
import type { HttpTransport } from './http';
import { extractLinks, fetchArticleInfo } from './article';
import { t } from '../i18n';

export interface ImportSettings {
  inboxFolder: string; // inbox (daily notes)
  attachmentFolder: string; // attachments
  articleFolder: string; // official-account articles
  fetchArticles: boolean;
}

export interface ImportResult {
  appended: boolean;
  articleNotes: string[];
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

/** Compact timestamp for sent-archive file names: 2026-08-16_1530 */
export function sentStamp(ts: number): string {
  const d = new Date(ts);
  return `${dayStamp(ts)}_${pad(d.getHours())}${pad(d.getMinutes())}`;
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
  const result: ImportResult = { appended: false, articleNotes: [] };

  await ensureFolder(app, settings.inboxFolder);
  await ensureFolder(app, settings.attachmentFolder);
  await ensureFolder(app, settings.articleFolder);

  const lines: string[] = [];
  lines.push(`**${timeOfDay(msg.timeMs)}**`);
  if (msg.text.trim()) {
    lines.push('');
    lines.push(msg.text.trim());
  }

  // store attachments
  for (const att of msg.attachments) {
    let ext = att.name.includes('.') ? att.name.split('.').pop() : '';
    if (att.kind === 'image') ext = ext && ext !== 'bin' ? ext : 'jpg';
    const base = `${dayStamp(msg.timeMs)}_${timeOfDay(msg.timeMs).replace(':', '')}`;
    const path = `${settings.attachmentFolder}/${base}_${sanitizeFileName(att.name.replace(/\.[^.]+$/, '') || att.kind)}.${ext || 'bin'}`;
    try {
      // writeBinary needs an ArrayBuffer; slice out the exact region from the Uint8Array view
      const ab = att.data.buffer.slice(att.data.byteOffset, att.data.byteOffset + att.data.byteLength) as ArrayBuffer;
      await app.vault.adapter.writeBinary(path, ab);
      const rel = path;
      if (att.kind === 'image') {
        lines.push('');
        lines.push(`![[${rel}]]`);
      } else {
        lines.push('');
        lines.push(`[[${rel}|${att.name}]]`);
      }
    } catch {
      lines.push('');
      lines.push(`> ${t('importer.attachFailed', { name: att.name })}`);
    }
  }

  // links -> article notes
  const links = extractLinks(msg.text);
  if (settings.fetchArticles && links.length) {
    for (const url of links.slice(0, 5)) {
      const info = await fetchArticleInfo(transport, url);
      const title = info?.title || url;
      const notePath = `${settings.articleFolder}/${dayStamp(msg.timeMs)} ${sanitizeFileName(title)}.md`;
      try {
        if (!(await app.vault.adapter.exists(notePath))) {
          const body = [
            `# ${title}`,
            '',
            `> **${t('importer.source')}**: ${url}`,
            `> **${t('importer.imported')}**: ${new Date(msg.timeMs).toLocaleString()}`,
            `> **${t('importer.from')}**: ${msg.from}`,
            info?.description ? `> **${t('importer.summary')}**: ${info.description}` : '',
            '',
          ].join('\n');
          await app.vault.create(notePath, body);
          result.articleNotes.push(notePath);
        }
        lines.push('');
        lines.push(`[[${notePath.replace(/\.md$/, '')}|${title}]]`);
      } catch {
        /* a failed article note must not break the inbox entry */
      }
    }
  }

  // append to today's inbox (sender goes in frontmatter so agents can look up the recipient ID)
  const dailyPath = `${settings.inboxFolder}/${dayStamp(msg.timeMs)}.md`;
  const header = `---\ndate: ${dayStamp(msg.timeMs)}\nsender: ${msg.from}\n---\n\n# ${t('importer.inboxTitle', { date: dayStamp(msg.timeMs) })}\n\n`;
  const block = lines.join('\n') + '\n\n';
  try {
    const exists = await app.vault.adapter.exists(dailyPath);
    const prev = exists ? await app.vault.adapter.read(dailyPath) : header;
    await app.vault.adapter.write(dailyPath, prev + block);
    result.appended = true;
  } catch {
    /* ignore */
  }

  return result;
}
