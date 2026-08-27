/** Outbox: an agent/user drops pending-send files into the vault; the plugin consumes and deletes them */
import type { App } from 'obsidian';
import type { IlinkClient } from './core/ilink';
import { isVideoExt } from './core/ilink';
import type { StateStore } from './core/store';
import type { OutboundAttachment } from './core/types';
import { appendOutbound, dayStamp, ensureFolder, quoteBlock, sanitizeFileName, timeOfDay } from './core/importer';
import { buildSendFailure, t } from './i18n';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);

export class Outbox {
  constructor(private app: App) {}

  /**
   * Scan and process all pending-send files; returns the processed count.
   * This is a one-to-one channel: every file is delivered to the account that
   * scanned to bind the bot (the owner), so the file name carries no recipient.
   * .md files are sent as text; images/videos/other binaries go through the CDN.
   * Successful sends delete the outbox file and are recorded in the daily
   * conversation note; media sends also keep a copy in the attachment folder.
   */
  async flush(
    client: IlinkClient,
    store: StateStore,
    folder: string,
    inboxFolder: string,
    attachmentFolder: string,
  ): Promise<number> {
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
        processed += await this.flushTextFile(client, path, to, contextToken, inboxFolder);
        continue;
      }
      if (IMAGE_EXTS.has(ext) || isVideoExt(ext) || BINARY_EXTS.has(ext)) {
        processed += await this.flushMediaFile(client, path, name, to, contextToken, inboxFolder, attachmentFolder);
      }
      // unknown extensions are left in place (the user can move them out manually)
    }
    return processed;
  }

  /** .md -> send the content as a text message */
  private async flushTextFile(
    client: IlinkClient,
    path: string,
    to: string,
    contextToken: string,
    inboxFolder: string,
  ): Promise<number> {
    const content = (await this.app.vault.adapter.read(path)).trim();
    if (!content) {
      await this.app.vault.adapter.remove(path);
      return 0;
    }
    const res = await client.sendText(to, content, contextToken);
    if (res.ok) {
      const now = Date.now();
      await appendOutbound(this.app, inboxFolder, now, to, [
        `**${timeOfDay(now)}** · ${t('importer.sent')}`,
        '',
        ...quoteBlock(content),
      ]);
      await this.app.vault.adapter.remove(path);
      return 1;
    }
    // Failure: append a categorized reason + fix hint; the file will be retried next flush
    // (when rate-limited, keeping the file avoids hammering the gateway)
    const note = `\n\n<!-- Wechatian send failed: ${buildSendFailure(res.errmsg, res.ret, contextToken)} -->\n`;
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
    inboxFolder: string,
    attachmentFolder: string,
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
      // keep a copy next to received media so the conversation note can link it
      const now = Date.now();
      const copyPath = `${attachmentFolder}/${dayStamp(now)}_${timeOfDay(now).replace(':', '')}_sent_${sanitizeFileName(name)}`;
      let linkLine = name;
      try {
        await ensureFolder(this.app, attachmentFolder);
        // writeBinary needs an ArrayBuffer; slice out the exact region from the Uint8Array view
        const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        await this.app.vault.adapter.writeBinary(copyPath, ab);
        linkLine = kind === 'image' ? `![[${copyPath}]]` : `[[${copyPath}|${name}]]`;
      } catch {
        /* the copy is best-effort; the send itself already succeeded */
      }
      await appendOutbound(this.app, inboxFolder, now, to, [
        `**${timeOfDay(now)}** · ${t('importer.sent')}`,
        '',
        ...quoteBlock(linkLine),
      ]);
      await this.app.vault.adapter.remove(path);
      return 1;
    }
    // Failure: record a categorized reason + fix hint in a sidecar note, visible without blocking retries
    const notePath = `${path}.wechatian-failed.md`;
    const note = `# ${name}\n\n${buildSendFailure(res.errmsg, res.ret, contextToken)}\n`;
    await this.app.vault.adapter.write(notePath, note);
    return 0;
  }
}

/** Common document/media extensions accepted as outbound files */
const BINARY_EXTS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'zip', 'tar', 'gz',
  'mp3', 'amr', 'wav', 'silk', 'm4a',
]);
