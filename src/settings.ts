/** Plugin settings: declarative definitions (1.13+) with an imperative login section */
import type { App } from 'obsidian';
import { Notice, PluginSettingTab, Setting, type SettingDefinitionItem, type TextComponent } from 'obsidian';
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
  fetchArticles: boolean; // fetch link metadata and create article notes
  groupArticlesByAccount: boolean; // one subfolder per official account under the article folder
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
  fetchArticles: true,
  groupArticlesByAccount: true,
  autoImport: true,
  notifyOnMessage: true,
};

const FOLDER_KEYS = ['inboxFolder', 'attachmentFolder', 'articleFolder', 'outboxFolder'];

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

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  setControlValue(key: string, value: unknown): void {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    if (key === 'language') {
      this.plugin.applyLanguage(value as WechatianSettings['language']); // switch commands/status bar immediately
      this.update(); // re-render every label in the new language
    }
    if (FOLDER_KEYS.includes(key)) this.plugin.refreshAgentGuide(); // paths changed -> Agent.md must point at the new folders
    void this.plugin.saveSettings();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: t('set.autoConnect'),
        desc: t('set.autoConnect.desc'),
        control: { type: 'toggle', key: 'enabled', defaultValue: DEFAULT_SETTINGS.enabled },
      },
      {
        name: t('set.language'),
        desc: t('set.language.desc'),
        control: {
          type: 'dropdown',
          key: 'language',
          defaultValue: DEFAULT_SETTINGS.language,
          options: { system: t('set.language.system'), en: 'English', zh: '中文' },
        },
      },
      // Login section: dynamic QR flow, rendered imperatively via the escape hatch
      { name: t('login.status'), render: (setting) => this.renderLoginSection(setting.settingEl) },
      {
        name: t('set.inboxFolder'),
        desc: t('set.inboxFolder.desc'),
        control: { type: 'text', key: 'inboxFolder', defaultValue: DEFAULT_SETTINGS.inboxFolder },
      },
      {
        name: t('set.attachmentFolder'),
        desc: t('set.attachmentFolder.desc'),
        control: { type: 'text', key: 'attachmentFolder', defaultValue: DEFAULT_SETTINGS.attachmentFolder },
      },
      {
        name: t('set.articleFolder'),
        desc: t('set.articleFolder.desc'),
        control: { type: 'text', key: 'articleFolder', defaultValue: DEFAULT_SETTINGS.articleFolder },
      },
      {
        name: t('set.outboxFolder'),
        desc: t('set.outboxFolder.desc'),
        control: { type: 'text', key: 'outboxFolder', defaultValue: DEFAULT_SETTINGS.outboxFolder },
      },
      {
        name: t('set.autoImport'),
        desc: t('set.autoImport.desc'),
        control: { type: 'toggle', key: 'autoImport', defaultValue: DEFAULT_SETTINGS.autoImport },
      },
      {
        name: t('set.fetchArticles'),
        desc: t('set.fetchArticles.desc'),
        control: { type: 'toggle', key: 'fetchArticles', defaultValue: DEFAULT_SETTINGS.fetchArticles },
      },
      {
        name: t('set.groupByAccount'),
        desc: t('set.groupByAccount.desc'),
        control: {
          type: 'toggle',
          key: 'groupArticlesByAccount',
          defaultValue: DEFAULT_SETTINGS.groupArticlesByAccount,
        },
      },
      {
        name: t('set.notify'),
        control: { type: 'toggle', key: 'notifyOnMessage', defaultValue: DEFAULT_SETTINGS.notifyOnMessage },
      },
      {
        name: '',
        searchable: false,
        render: (setting) => {
          setting.settingEl.createEl('p', { text: t('set.footer'), cls: 'setting-item-description' });
        },
      },
      // Where agents learn the outbox protocol: a note file maintained inside the vault
      {
        name: t('set.agentGuide'),
        desc: t('set.agentGuide.desc', { path: `${this.plugin.settings.inboxFolder}/Agent.md` }),
      },
    ];
  }

  /** Login-status section: shows the bound ID when logged in; inline QR code otherwise */
  private renderLoginSection(containerEl: HTMLElement): void {
    this.alive = true;
    containerEl.empty();
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
              this.update();
            }),
        );

      // Test send — only shown once bound (one-to-one channel: the recipient is the user themselves)
      let testInput: TextComponent | null = null;
      new Setting(section)
        .setName(t('sendTest.name'))
        .setDesc(t('sendTest.desc'))
        .addText((txt) => {
          txt.setPlaceholder(t('sendTest.placeholder')).setValue('Hello from wechatian');
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
        if (this.alive) statusEl.setText(msg);
      },
      cancelled: () => !this.alive,
    });

    if (!this.alive) return;
    if (out) {
      this.plugin.applyLogin(out);
      new Notice(t('notice.loggedIn'));
      this.update(); // re-render: switch to the "bound" view
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
      el.createDiv({ text: url });
    }
    el.createDiv({ text: url, cls: 'wechatian-qr-url' });
  }
}
