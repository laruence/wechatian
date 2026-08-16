/** Outbox: an agent/user drops pending-send files into the vault; the plugin consumes and deletes them */
import type { App } from 'obsidian';
import type { IlinkClient } from './core/ilink';
import { isVideoExt } from './core/ilink';
import type { StateStore } from './core/store';
import type { OutboundAttachment } from './core/types';
import { ensureFolder, sentStamp, sanitizeFileName } from './core/importer';
import { t } from './i18n';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);

export class Outbox {
  constructor(private app: App) {}

  /**
   * Scan and process all pending-send files; returns the processed count.
   * This is a one-to-one channel: every file is delivered to the account that
   * scanned to bind the bot (the owner), so the file name carries no recipient.
   * .md files are sent as text; images/videos/other binaries go through the CDN.
   * Successful sends are archived into sentFolder before the outbox file is deleted.
   */
  async flush(client: IlinkClient, store: StateStore, folder: string, sentFolder: string): Promise<number> {
    if (!folder || !(await this.app.vault.adapter.exists(folder))) return 0;
    const st = store.get();
    const to = st.scannedUser.trim();
    if (!to) return 0; // not logged in yet
    const contextToken = st.contextTokens[to] ?? '';
    const listing = await this.app.vault.adapter.list(folder);
    let processed = 0;
    for (const path of listing.files) {
      const name = path.split('/').pop() ?? '';
      const ext = (name.includes('.') ? name.split('.').pop() ?? '' : '').toLowerCase();

      if (ext === 'md') {
        processed += await this.flushTextFile(client, path, to, contextToken, sentFolder);
        continue;
      }
      if (IMAGE_EXTS.has(ext) || isVideoExt(ext) || BINARY_EXTS.has(ext)) {
        processed += await this.flushMediaFile(client, path, name, to, contextToken, sentFolder);
      }
      // unknown extensions are left in place (the user can move them out manually)
    }
    return processed;
  }

  /** Copy the sent content into the sent folder (best-effort; the send itself already succeeded) */
  private async archive(sentFolder: string, fileName: string, content: string): Promise<void> {
    if (!sentFolder) return;
    try {
      await ensureFolder(this.app, sentFolder);
      const path = `${sentFolder}/${sentStamp(Date.now())}_${sanitizeFileName(fileName)}`;
      await this.app.vault.adapter.write(path, content);
    } catch {
      /* ignore */
    }
  }

  /** .md -> send the content as a text message */
  private async flushTextFile(
    client: IlinkClient,
    path: string,
    to: string,
    contextToken: string,
    sentFolder: string,
  ): Promise<number> {
    const content = (await this.app.vault.adapter.read(path)).trim();
    if (!content) {
      await this.app.vault.adapter.remove(path);
      return 0;
    }
    const res = await client.sendText(to, content, contextToken);
    if (res.ok) {
      await this.archive(sentFolder, path.split('/').pop() ?? 'message.md', `${content}\n`);
      await this.app.vault.adapter.remove(path);
      return 1;
    }
    // Failure: append the reason at the end of the file; it will be retried next flush
    // (when rate-limited, keeping the file avoids hammering the gateway)
    const note = `\n\n<!-- ${t('outbox.failedNote', { ret: res.ret, msg: res.errmsg.trim() || res.raw || 'unknown' })} -->\n`;
    await this.app.vault.adapter.write(path, content + note);
    return 0;
  }

  /** image/video/file -> AES-ECB encrypt, upload to CDN, send as a media message */
  private async flushMediaFile(
    client: IlinkClient,
    path: string,
    name: string,
    to: string,
    contextToken: string,
    sentFolder: string,
  ): Promise<number> {
    const ext = (name.includes('.') ? name.split('.').pop() ?? '' : '').toLowerCase();
    const kind: OutboundAttachment['kind'] = IMAGE_EXTS.has(ext) ? 'image' : isVideoExt(ext) ? 'video' : 'file';
    let data: Uint8Array;
    try {
      data = new Uint8Array(await this.app.vault.adapter.readBinary(path));
    } catch {
      return 0; // unreadable: leave for manual inspection
    }
    const res = await client.sendMedia(to, { kind, name, data }, contextToken);
    if (res.ok) {
      await this.archive(sentFolder, name, ''); // binary: archive a 0-byte copy to keep a record
      await this.app.vault.adapter.remove(path);
      return 1;
    }
    // Failure: record the reason in a sidecar note so it is visible without blocking retries
    const notePath = `${path}.wechatian-failed.md`;
    const note = `# ${name}\n\n${t('outbox.failedNote', { ret: res.ret, msg: res.errmsg.trim() || res.raw || 'unknown' })}\n`;
    await this.app.vault.adapter.write(notePath, note);
    return 0;
  }
}

/** Common document/media extensions accepted as outbound files */
const BINARY_EXTS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'zip', 'tar', 'gz',
  'mp3', 'amr', 'wav', 'silk', 'm4a',
]);
