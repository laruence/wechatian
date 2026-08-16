/** Runtime state persistence: token / cursor / context_token / quota (stored in state.json inside the plugin data dir) */
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
  private saveTimer: number | null = null;

  constructor(
    private app: App,
    private file: string,
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
    try {
      if (await this.app.vault.adapter.exists(this.file)) {
        const raw = await this.app.vault.adapter.read(this.file);
        this.state = { ...this.emptyState(), ...(JSON.parse(raw) as Partial<BotState>) };
      }
    } catch {
      /* fall back to empty state when the stored state is corrupted */
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
    }
    try {
      await this.app.vault.adapter.write(this.file, JSON.stringify(this.state));
    } catch {
      /* retry on next write */
    }
  }

  /** Message dedup: returns true if this key was already seen */
  seen(key: string): boolean {
    if (this.state.dedup.includes(key)) return true;
    this.state.dedup.push(key);
    this.scheduleSave();
    return false;
  }
}
