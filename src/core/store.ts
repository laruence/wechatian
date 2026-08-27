/** Runtime state persistence: token / cursor / context_token / quota (state.json in the plugin data dir) */
import type { App } from 'obsidian';

export interface BotState {
  token: string;
  botId: string;
  baseUrl: string; // the gateway may return a dedicated baseurl on scan
  scannedUser: string; // ilink_user_id of the user who scanned
  cursor: string;
  contextTokens: Record<string, string>;
  quotaTimes: number[]; // sliding-window timestamps for the proactive-send quota
  pausedUntil: number; // pause deadline after session expiry
  dedup: string[]; // recent-message dedup ring
  lastError: string;
  lastPollAt: number;
}

const DEDUP_KEEP = 500;

export class StateStore {
  private state: BotState;
  /** index over state.dedup so lookups are O(1) instead of scanning 500 keys per message */
  private dedupSet = new Set<string>();
  private saveTimer: number | null = null;
  /** last save error, so a persistent failure is logged once instead of every retry */
  private saveError: string | null = null;

  constructor(
    private app: App,
    private file: string,
    /** pre-0.1.4 location, migrated on first read if the new file is absent */
    private legacyFile?: string,
  ) {
    this.state = this.load();
  }

  private emptyState(): BotState {
    return {
      token: '',
      botId: '',
      baseUrl: '',
      scannedUser: '',
      cursor: '',
      contextTokens: {},
      quotaTimes: [],
      pausedUntil: 0,
      dedup: [],
      lastError: '',
      lastPollAt: 0,
    };
  }

  private load(): BotState {
    return this.emptyState();
  }

  /** adapter reads are async; await once at plugin startup */
  async init(): Promise<void> {
    for (const path of [this.file, this.legacyFile]) {
      if (!path) break;
      try {
        if (await this.app.vault.adapter.exists(path)) {
          const raw = await this.app.vault.adapter.read(path);
          this.state = { ...this.emptyState(), ...(JSON.parse(raw) as Partial<BotState>) };
          this.dedupSet = new Set(this.state.dedup);
          return; // a legacy state.json is read as-is; the next save writes it to the new location
        }
      } catch (e) {
        /* corrupted state: fall back to an empty one, but say so */
        console.warn(`wechatian: failed to read state from ${path}:`, e);
      }
    }
  }

  get(): BotState {
    return this.state;
  }

  update(mutator: (s: BotState) => void): void {
    mutator(this.state);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, 300);
  }

  async saveNow(): Promise<void> {
    // Trim the dedup ring to keep state.json from growing unbounded
    if (this.state.dedup.length > DEDUP_KEEP) {
      this.state.dedup = this.state.dedup.slice(-DEDUP_KEEP);
      this.dedupSet = new Set(this.state.dedup); // keep the index in sync with the trimmed array
    }
    try {
      await this.app.vault.adapter.write(this.file, JSON.stringify(this.state));
      this.saveError = null;
    } catch (e) {
      // Never swallow this silently again: a failed write means the binding is
      // memory-only and the user will be asked to re-scan on the next start.
      const msg = String((e as Error)?.message ?? e);
      if (msg !== this.saveError) {
        this.saveError = msg;
        console.error(`wechatian: cannot persist state to ${this.file}: ${msg}`);
      }
    }
  }

  /** Message dedup: returns true if this key was already seen */
  seen(key: string): boolean {
    if (this.dedupSet.has(key)) return true;
    this.dedupSet.add(key);
    this.state.dedup.push(key);
    this.scheduleSave();
    return false;
  }
}
