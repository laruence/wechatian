/** Plugin settings: login-status section + folder/switch configuration */
import type { App } from 'obsidian';
import { Notice, PluginSettingTab, Setting, type TextComponent } from 'obsidian';
import type WechatianPlugin from './main';
import { loginLoop } from './core/qrlogin';
import { encodeQr } from './core/qrcode';
import { t } from './i18n';

export interface WechatianSettings {
  language: 'system' | 'en' | 'zh'; // UI language; system follows Obsidian
  enabled: boolean; // auto-connect on startup
  inboxFolder: string;
  attachmentFolder: string;
  articleFolder: string;
  outboxFolder: string; // outbox folder (agents drop pending-send files here)
  sentFolder: string; // sent folder (copies of successfully sent messages)
  fetchArticles: boolean; // fetch link metadata and create article notes
  autoImport: boolean;
  notifyOnMessage: boolean;
}

export const DEFAULT_SETTINGS: WechatianSettings = {
  language: 'system',
  enabled: true,
  inboxFolder: 'Wechatian',
  attachmentFolder: 'Wechatian/attachments',
  articleFolder: 'Wechatian/articles',
  outboxFolder: 'Wechatian/outbox',
  sentFolder: 'Wechatian/sentbox',
  fetchArticles: true,
  autoImport: true,
  notifyOnMessage: true,
};

export class WechatianSettingTab extends PluginSettingTab {
  /** Liveness flag for the settings pane: aborts QR polling when switched away/closed */
  private alive = false;

  constructor(
    app: App,
    private plugin: WechatianPlugin,
  ) {
    super(app, plugin);
  }

  hide(): void {
    this.alive = false;
  }

  display(): void {
    this.alive = true;
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName(t('set.autoConnect'))
      .setDesc(t('set.autoConnect.desc'))
      .addToggle((t2) =>
        t2.setValue(this.plugin.settings.enabled).onChange(async (v) => {
          this.plugin.settings.enabled = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.language'))
      .setDesc(t('set.language.desc'))
      .addDropdown((d) => {
        d.addOption('system', t('set.language.system'))
          .addOption('en', 'English')
          .addOption('zh', '中文')
          .setValue(this.plugin.settings.language)
          .onChange(async (v) => {
            const lang = (['system', 'en', 'zh'].includes(v) ? v : 'system') as WechatianSettings['language'];
            this.plugin.settings.language = lang;
            await this.plugin.saveSettings();
            this.plugin.applyLanguage(lang); // switch commands/status bar immediately
            this.display(); // re-render the whole page in the new language
          });
      });

    // Login section goes right below the language selector
    this.renderLoginSection(containerEl);

    new Setting(containerEl)
      .setName(t('set.inboxFolder'))
      .setDesc(t('set.inboxFolder.desc'))
      .addText((t2) =>
        t2.setValue(this.plugin.settings.inboxFolder).onChange(async (v) => {
          this.plugin.settings.inboxFolder = v.trim() || 'Wechatian';
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.attachmentFolder'))
      .setDesc(t('set.attachmentFolder.desc'))
      .addText((t2) =>
        t2.setValue(this.plugin.settings.attachmentFolder).onChange(async (v) => {
          this.plugin.settings.attachmentFolder = v.trim() || 'Wechatian/attachments';
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.articleFolder'))
      .setDesc(t('set.articleFolder.desc'))
      .addText((t2) =>
        t2.setValue(this.plugin.settings.articleFolder).onChange(async (v) => {
          this.plugin.settings.articleFolder = v.trim() || 'Wechatian/articles';
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.outboxFolder'))
      .setDesc(t('set.outboxFolder.desc'))
      .addText((t2) =>
        t2.setValue(this.plugin.settings.outboxFolder).onChange(async (v) => {
          this.plugin.settings.outboxFolder = v.trim() || 'Wechatian/outbox';
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.sentFolder'))
      .setDesc(t('set.sentFolder.desc'))
      .addText((t2) =>
        t2.setValue(this.plugin.settings.sentFolder).onChange(async (v) => {
          this.plugin.settings.sentFolder = v.trim() || 'Wechatian/sentbox';
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.autoImport'))
      .setDesc(t('set.autoImport.desc'))
      .addToggle((t2) =>
        t2.setValue(this.plugin.settings.autoImport).onChange(async (v) => {
          this.plugin.settings.autoImport = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.fetchArticles'))
      .setDesc(t('set.fetchArticles.desc'))
      .addToggle((t2) =>
        t2.setValue(this.plugin.settings.fetchArticles).onChange(async (v) => {
          this.plugin.settings.fetchArticles = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.notify'))
      .addToggle((t2) =>
        t2.setValue(this.plugin.settings.notifyOnMessage).onChange(async (v) => {
          this.plugin.settings.notifyOnMessage = v;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl('p', {
      text: t('set.footer'),
      cls: 'setting-item-description',
    });

    // Where agents learn the outbox protocol: a note file maintained inside the vault
    new Setting(containerEl).setName(t('set.agentGuide')).setDesc(
      t('set.agentGuide.desc', { path: `${this.plugin.settings.inboxFolder}/Agent.md` }),
    );
  }

  /** Login-status section: shows the bound ID when logged in; inline QR code otherwise */
  private renderLoginSection(containerEl: HTMLElement): void {
    const st = this.plugin.getState();
    const section = containerEl.createDiv({ cls: 'wechatian-login-section' });

    if (st?.token) {
      new Setting(section)
        .setName(t('login.status'))
        .setDesc(t('login.bound', { bot: st.botId || '?', user: st.scannedUser || '?' }))
        .addButton((b) =>
          b.setButtonText(t('login.rescan')).onClick(() => {
            void this.startInlineLogin(section);
          }),
        )
        .addButton((b) =>
          b
            .setButtonText(t('login.logout'))
            .setDestructive()
            .onClick(async () => {
              this.plugin.disconnect();
              this.plugin.clearCredentials();
              new Notice(t('notice.loggedOut'));
              this.display();
            }),
        );

      // Test send — only shown once bound (one-to-one channel: the recipient is the user themselves)
      let testInput: TextComponent | null = null;
      new Setting(section)
        .setName(t('sendTest.name'))
        .setDesc(t('sendTest.desc'))
        .addText((txt) => {
          txt.setPlaceholder("Hello, I'm Wechatian").setValue("Hello, I'm Wechatian");
          txt.inputEl.addClass('wechatian-send-input');
          testInput = txt;
        })
        .addButton((b) => {
          b.setButtonText(t('sendTest.send')).setCta();
          b.onClick(async () => {
            const text = (testInput?.getValue() ?? '').trim();
            if (!text) {
              new Notice(t('sendTest.empty'));
              return;
            }
            b.setDisabled(true);
            const res = await this.plugin.sendTestMessage(text);
            b.setDisabled(false);
            if (res.ok) {
              new Notice(t('sendTest.ok'));
            } else if (/context[_ ]?token/i.test(res.errmsg)) {
              new Notice(t('sendTest.needFirstMessage'));
            } else {
              new Notice(t('sendTest.failed', { err: res.errmsg }));
            }
          });
        });
    } else {
      section.createEl('p', { text: t('login.notLoggedIn') });
      void this.startInlineLogin(section);
    }
  }

  /** Inline scan inside the settings page: render QR -> poll -> refresh the pane on success */
  private async startInlineLogin(section: HTMLElement): Promise<void> {
    // Clear existing content and show the scan area
    section.empty();
    const qrWrap = section.createDiv({ cls: 'wechatian-qr' });
    const statusEl = section.createEl('p', { text: t('login.fetching'), cls: 'wechatian-qr-status' });

    const out = await loginLoop(this.plugin.getTransport(), this.plugin.getApiBase(), {
      onQr: (url) => {
        if (!this.alive) return;
        this.renderQrInto(qrWrap, url);
        statusEl.setText(t('login.waiting'));
      },
      onScanned: () => {
        if (this.alive) statusEl.setText(t('login.scanned'));
      },
      onError: (msg) => {
        if (this.alive) statusEl.setText(`⚠️ ${msg}`);
      },
      cancelled: () => !this.alive,
    });

    if (!this.alive) return;
    if (out) {
      this.plugin.applyLogin(out);
      new Notice(t('notice.loggedIn'));
      this.display(); // re-render: switch to the "bound" view
    }
  }

  /** Render the QR code into the given container (canvas + URL fallback text) */
  private renderQrInto(el: HTMLElement, url: string): void {
    el.empty();
    try {
      const qr = encodeQr(url);
      const n = qr.size + 8; // leave a quiet zone
      const cell = Math.max(3, Math.min(8, Math.floor(240 / n)));
      const canvas = el.createEl('canvas');
      canvas.width = n * cell;
      canvas.height = n * cell;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      const quiet = 4;
      for (let r = 0; r < qr.size; r++) {
        for (let c = 0; c < qr.size; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
          }
        }
      }
    } catch {
      // Fall back to URL text when encoding fails
      el.createEl('div', { text: url });
    }
    el.createEl('div', { text: url, cls: 'wechatian-qr-url' });
  }
}
