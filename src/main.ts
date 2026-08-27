/** Wechatian main plugin: WeChat message bridge */
import { Notice, Plugin, TFile } from 'obsidian';
import { IlinkClient, type PollResult, sleep } from './core/ilink';
import type { InboundMessage } from './core/types';
import { ObsidianTransport } from './core/transport-obsidian';
import { NodeTransport } from './core/transport-node';
import { StateStore, type BotState } from './core/store';
import { appendOutbound, ensureFolder, importMessage, quoteBlock, timeOfDay, type ImportResult } from './core/importer';
import { ensureAgentGuide } from './core/agent-guide';
import type { LoginOutcome } from './core/qrlogin';
import { DEFAULT_SETTINGS, WechatianSettings, WechatianSettingTab } from './settings';
import { QrLoginModal } from './qr-modal';
import { Outbox } from './outbox';
import { CDN_BASE, ILINK_DEFAULT_BASE } from './core/constants';
import { applyLanguage, buildReceiptReplies, buildSendFailure, resolvedLanguage, t, type ReceiptReplyInput, type UiLanguage } from './i18n';

/** Pre-0.1.4 location; kept so an existing binding survives the move (the old
 * path lived in the vault root and was never auto-created, so writes silently
 * failed on fresh installs) */
const LEGACY_STATE_FILE = '.wechatian-plugin/state.json';

type ConnState = 'disconnected' | 'connecting' | 'connected' | 'expired' | 'error';

export default class WechatianPlugin extends Plugin {
  settings: WechatianSettings = DEFAULT_SETTINGS;
  store!: StateStore;
  private client: IlinkClient | null = null;
  private transport = new ObsidianTransport();
  /** article/image fetches run on Node's http stack: requestUrl's IPC channel has no
   *  timeout/cancel and can wedge the app on misbehaving hosts (issue #1) */
  private articleTransport = new NodeTransport();
  private polling = false;
  private stopRequested = false;
  private connState: ConnState = 'disconnected';
  private statusBar: HTMLElement | null = null;
  private outbox: Outbox | null = null;
  private statusListeners = new Set<() => void>();
  /** command id -> i18n key, so names can be re-rendered when the language changes */
  private commandNameKeys: Record<string, string> = {};

  async onload(): Promise<void> {
    await this.loadSettings();
    applyLanguage(this.settings.language); // respect the saved choice; 'system' follows Obsidian
    // State lives inside the plugin's own folder: that directory always exists
    // once the plugin is installed, so the write can never fail on a missing parent
    const stateDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    this.store = new StateStore(this.app, `${stateDir}/state.json`, LEGACY_STATE_FILE);
    await this.store.init();
    this.outbox = new Outbox(this.app);
    await this.ensureFolders();

    this.statusBar = this.addStatusBarItem();
    this.renderStatus();

    const cmds: Array<[string, string, () => void]> = [
      ['wechatian-connect', 'cmd.connect', () => void this.connect()],
      ['wechatian-disconnect', 'cmd.disconnect', () => this.disconnect()],
      ['wechatian-login', 'cmd.login', () => this.startLogin()],
      ['wechatian-open-inbox', 'cmd.inbox', () => void this.openTodayInbox()],
    ];
    for (const [id, key, callback] of cmds) {
      this.commandNameKeys[id] = key;
      this.addCommand({ id, name: t(key), callback });
    }

    this.addSettingTab(new WechatianSettingTab(this.app, this));

    // Auto-connect once the vault is ready
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.enabled && this.store.get().token) {
        void this.startPollLoop();
      } else if (this.settings.enabled) {
        this.setConn('disconnected');
        new Notice(t('notice.notLoggedIn', { cmd: t('cmd.login') }));
      }
    });
  }

  onunload(): void {
    this.disconnect();
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Record<string, unknown> | null;
    if (raw && typeof raw === 'object') {
      delete raw.allowFrom; // legacy field: whitelist removed, only the scanning user is accepted
      delete raw.sentFolder; // legacy field: sent copies now live in the daily conversation note
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Switch the UI language at runtime (commands, status bar; the settings page re-renders itself) */
  applyLanguage(lang: UiLanguage): void {
    applyLanguage(lang);
    // app.commands exists at runtime but is not part of the public type definitions
    const registry = (this.app as unknown as { commands?: { findCommand(id: string): { name: string } | null } }).commands;
    for (const [id, key] of Object.entries(this.commandNameKeys)) {
      const cmd = registry?.findCommand(id);
      if (cmd) cmd.name = t(key);
    }
    this.renderStatus();
    void ensureAgentGuide(this.app, this.settings, resolvedLanguage());
  }

  /** Create the whole Wechat directory tree + Agent.md once the plugin is enabled */
  private async ensureFolders(): Promise<void> {
    const s = this.settings;
    for (const folder of [s.inboxFolder, s.attachmentFolder, s.articleFolder, s.outboxFolder]) {
      try {
        await ensureFolder(this.app, folder);
      } catch {
        /* a missing folder is only a problem when a message actually needs it */
      }
    }
    await ensureAgentGuide(this.app, s, resolvedLanguage());
  }

  /** Directory settings changed: re-sync Agent.md with the new paths */
  refreshAgentGuide(): void {
    void ensureAgentGuide(this.app, this.settings, resolvedLanguage());
  }

  /** Status-bar rendering */
  private renderStatus(): void {
    if (!this.statusBar) return;
    const map: Record<ConnState, string> = {
      disconnected: t('status.disconnected'),
      connecting: t('status.connecting'),
      connected: t('status.connected'),
      expired: t('status.expired'),
      error: t('status.error'),
    };
    this.statusBar.setText(`Wechatian ${map[this.connState]}`);
    this.statusBar.setAttribute('aria-label', this.store.get().lastError || '');
  }

  private setConn(s: ConnState): void {
    this.connState = s;
    this.renderStatus();
    for (const fn of this.statusListeners) {
      try {
        fn();
      } catch {
        /* listener errors must not break the main flow */
      }
    }
  }

  /** Subscribe to connection-state changes (used by the settings page) */
  onStatusChange(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  /** Current connection state */
  getConnState(): ConnState {
    return this.connState;
  }

  /** Login state and binding info (shown on the settings page) */
  getState(): BotState {
    return this.store.get();
  }

  /** Whether polling is active */
  isPolling(): boolean {
    return this.polling;
  }

  /** HTTP transport layer (used for scanning in the settings page) */
  getTransport(): ObsidianTransport {
    return this.transport;
  }

  /** ilink gateway address (scan-login always uses the default gateway) */
  getApiBase(): string {
    return ILINK_DEFAULT_BASE;
  }

  /** Persist the scan-login result and start polling */
  applyLogin(out: LoginOutcome): void {
    this.store.update((st) => {
      st.token = out.token;
      st.botId = out.botId;
      st.baseUrl = out.baseUrl;
      st.scannedUser = out.scannedUser;
      st.cursor = '';
      st.contextTokens = {};
      st.pausedUntil = 0;
    });
    void this.store.saveNow();
    void this.startPollLoop();
  }

  /** Clear login credentials (re-scan required) */
  clearCredentials(): void {
    this.store.update((st) => {
      st.token = '';
      st.botId = '';
      st.baseUrl = '';
      st.scannedUser = '';
      st.cursor = '';
      st.contextTokens = {};
      st.pausedUntil = 0;
    });
    void this.store.saveNow();
    this.setConn('disconnected');
  }

  /** Start scan-login (for the command palette) */
  startLogin(): void {
    new QrLoginModal(this.app, this.transport, ILINK_DEFAULT_BASE, (out) => {
      this.applyLogin(out);
      new Notice(t('notice.loggedIn'));
    }).open();
  }

  /** Disconnect and clear login credentials */
  async logout(): Promise<void> {
    this.disconnect();
    this.clearCredentials();
    new Notice(t('notice.loggedOut'));
  }

  /** Connect directly with the stored token */
  async connect(): Promise<void> {
    const st = this.store.get();
    if (!st.token) {
      this.startLogin();
      return;
    }
    if (!this.polling) await this.startPollLoop();
  }

  disconnect(): void {
    this.stopRequested = true;
    this.polling = false;
    this.client = null;
    this.setConn('disconnected');
  }

  /** Send a test message to the bound account (one-to-one; used by the settings page) */
  async sendTestMessage(text: string): Promise<{ ok: boolean; errmsg: string; ret: number; contextToken: string }> {
    const st = this.store.get();
    const to = st.scannedUser.trim();
    if (!to || !st.token.trim()) return { ok: false, errmsg: t('sendTest.notBound'), ret: 0, contextToken: '' };
    const client = this.client ?? this.makeClient();
    const contextToken = st.contextTokens[to] ?? '';
    const res = await client.sendText(to, text, contextToken);
    if (res.ok) {
      const now = Date.now();
      await appendOutbound(this.app, this.settings.inboxFolder, now, to, [
        `**${timeOfDay(now)}** · ${t('importer.sent')}`,
        '',
        ...quoteBlock(text),
      ]);
    }
    return { ok: res.ok, errmsg: res.errmsg.trim() || res.raw || '', ret: res.ret, contextToken };
  }

  private makeClient(): IlinkClient {
    const st = this.store.get();
    return new IlinkClient(
      this.transport,
      {
        baseUrl: st.baseUrl || ILINK_DEFAULT_BASE,
        cdnBase: CDN_BASE,
      },
      st.token,
    );
  }

  /** Main long-poll loop */
  private async startPollLoop(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    this.stopRequested = false;
    this.client = this.makeClient();
    this.setConn('connecting');

    let backoff = 1000;
    while (this.polling && !this.stopRequested) {
      const store = this.store;
      if (!store) break;
      const st = store.get();

      if (st.pausedUntil > Date.now()) {
        this.setConn('expired');
        await sleep(5000);
        continue;
      }

      const result: PollResult = await this.client.poll(st.cursor);

      if (result.sessionExpired) {
        store.update((s) => {
          s.pausedUntil = Date.now() + 3600_000;
          s.lastError = t('error.sessionExpired');
        });
        this.setConn('expired');
        new Notice(t('notice.sessionExpired'));
        await sleep(30_000);
        continue;
      }

      if (result.error) {
        store.update((s) => {
          s.lastError = result.error ?? '';
        });
        this.setConn('error');
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30_000);
        continue;
      }

      backoff = 1000;
      this.setConn('connected');
      store.update((s) => {
        s.lastError = '';
        s.lastPollAt = Date.now();
      });

      if (result.cursor) {
        store.update((s) => {
          s.cursor = result.cursor ?? '';
        });
      }

      const receipts: ReceiptReplyInput[] = [];
      for (const msg of result.messages) {
        receipts.push(...(await this.handleInbound(msg)));
      }
      // one batched receipt reply per polling round, not one per message
      if (receipts.length) {
        await this.sendReceiptReplies(receipts);
      }

      // Consume the outbox (pending-send files written by agents)
      try {
        await this.outbox?.flush(
          this.client,
          store,
          this.settings.outboxFolder,
          this.settings.inboxFolder,
          this.settings.attachmentFolder,
        );
      } catch {
        /* send failures must not block polling */
      }

      void store.saveNow();
    }
    this.polling = false;
  }

  /** Handle a single inbound message; returns a receipt entry when one should be sent */
  private async handleInbound(msg: InboundMessage): Promise<ReceiptReplyInput[]> {
    const store = this.store;
    if (!store) return [];

    // Only accept messages from the account that scanned to bind the bot.
    // Without this, anyone who discovers the bot ID could write into the vault.
    const scanned = store.get().scannedUser.trim();
    if (scanned && msg.from !== scanned) return [];

    // dedup
    const key = `${msg.from}|${msg.messageId}|${msg.timeMs}`;
    if (store.seen(key)) return [];

    // cache the context_token (credential for replying)
    const tok = (msg.raw.context_token ?? '').trim();
    if (tok) {
      store.update((s) => {
        s.contextTokens[msg.from] = tok;
      });
    }

    if (this.settings.notifyOnMessage) {
      const preview = msg.text.slice(0, 40) || `[${t('notice.attachments', { n: msg.attachments.length })}]`;
      new Notice(`${t('notice.prefix')} · ${msg.from.split('@')[0]}: ${preview}`);
    }

    if (this.settings.autoImport) {
      let result: ImportResult | null = null;
      try {
        result = await importMessage(this.app, this.articleTransport, msg, {
          inboxFolder: this.settings.inboxFolder,
          attachmentFolder: this.settings.attachmentFolder,
          articleFolder: this.settings.articleFolder,
          fetchArticles: this.settings.fetchArticles,
          groupArticlesByAccount: this.settings.groupArticlesByAccount,
        });
      } catch (e) {
        new Notice(t('notice.importFailed', { err: String((e as Error)?.message ?? e) }));
      }
      if (this.settings.autoReply) {
        return [
          result
            ? {
                ok: true,
                appended: result.appended,
                dailyNote: result.dailyNote,
                attachmentPaths: result.attachmentPaths,
                attachmentFailures: result.attachmentFailures,
                linkCount: result.linkCount,
                articleAssets: result.articleAssets,
                articleFailures: result.articleFailures,
              }
            : { ok: false, appended: false, dailyNote: '', attachmentPaths: [], attachmentFailures: [], linkCount: 0, articleAssets: [], articleFailures: [] },
        ];
      }
    }
    return [];
  }

  /**
   * One batched confirmation reply per polling round: saved files/images in a
   * table, articles with their note path and image directory, plain messages
   * with the daily note they landed in. Failures never break the receive flow.
   */
  private async sendReceiptReplies(receipts: ReceiptReplyInput[]): Promise<void> {
    try {
      const to = this.store.get().scannedUser.trim();
      if (!to) return;
      const client = this.client ?? this.makeClient();
      const contextToken = this.store.get().contextTokens[to] ?? '';
      const lines = buildReceiptReplies(receipts);
      if (!lines.length) return;

      const res = await client.sendText(to, lines.join('\n'), contextToken);
      if (res.ok) {
        await appendOutbound(this.app, this.settings.inboxFolder, Date.now(), to, [
          `**${timeOfDay(Date.now())}** · ${t('importer.sent')}`,
          '',
          ...quoteBlock(lines.join('\n')),
        ]);
      } else if (this.settings.notifyOnMessage) {
        // surface a categorized reason + fix hint, not a silent failure
        new Notice(t('sendTest.failed', { err: buildSendFailure(res.errmsg, res.ret, contextToken) }), 10000);
      }
    } catch {
      /* receipt replies are best-effort: a failure must not disturb receiving */
    }
  }

  private async openTodayInbox(): Promise<void> {
    const d = new Date();
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const path = `${this.settings.inboxFolder}/${today}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf().openFile(file);
    } else {
      new Notice(t('notice.noMsgToday', { path }));
    }
  }
}
