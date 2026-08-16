/** Scan-login modal: renders the QR code and polls scan status (the flow reuses loginLoop from core/qrlogin) */
import { App, Modal } from 'obsidian';
import type { HttpTransport } from './core/http';
import { loginLoop, type LoginOutcome } from './core/qrlogin';
import { encodeQr } from './core/qrcode';
import { t } from './i18n';

export class QrLoginModal extends Modal {
  private cancelled = false;
  private qrEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;

  constructor(
    app: App,
    private transport: HttpTransport,
    private baseUrl: string,
    private onDone: (out: LoginOutcome) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: t('modal.title') });
    contentEl.createEl('p', { text: t('modal.hint'), cls: 'wechatian-qr-hint' });
    this.qrEl = contentEl.createDiv({ cls: 'wechatian-qr wechatian-qr-center' });
    this.statusEl = contentEl.createEl('p', { text: t('login.fetching'), cls: 'wechatian-qr-status' });

    void loginLoop(this.transport, this.baseUrl, {
      onQr: (url) => {
        this.renderQr(url);
        this.setStatus(t('login.waiting'));
      },
      onScanned: () => this.setStatus(t('login.scanned')),
      onError: (msg) => this.setStatus(msg),
      cancelled: () => this.cancelled,
    }).then((out) => {
      if (!out || this.cancelled) return;
      this.setStatus(t('login.success'));
      this.close();
      this.onDone(out);
    });
  }

  private renderQr(url: string): void {
    if (!this.qrEl) return;
    this.qrEl.empty();
    try {
      const qr = encodeQr(url);
      const cell = 6;
      const quiet = 4;
      const n = qr.size + quiet * 2;
      const canvas = this.qrEl.createEl('canvas', { cls: 'wechatian-qr-canvas' });
      canvas.width = n * cell;
      canvas.height = n * cell;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      for (let r = 0; r < qr.size; r++) {
        for (let c = 0; c < qr.size; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
          }
        }
      }
      // Fallback: URL link (open directly on the phone when scanning is inconvenient)
      this.qrEl.createEl('a', { text: t('modal.openLink'), href: url, cls: 'wechatian-qr-link' });
    } catch (e) {
      this.qrEl.createEl('p', { text: t('modal.renderFailed', { err: String((e as Error)?.message ?? e) }) });
    }
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.setText(text);
  }

  onClose(): void {
    this.cancelled = true;
    this.contentEl.empty();
  }
}
