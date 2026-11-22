/**
 * Drives the injected pill and performs its actions in this context.
 *
 * The pill itself lives in the visible Big Picture window (see bridge.ts); this
 * class keeps it installed, polls it for clicks/shortcut presses, and opens
 * Decky's Quick Access Menu tab from here, where Steam's UI store is reachable.
 */
import { POLL_MS, type HintMode, type PollState, pollHint, pushHint, removeHint } from "./bridge";
import { getConfig, subscribeConfig } from "./config";
import { report } from "./report";
import {
  DECKY_QAM_TAB,
  cancelOpenFallback,
  closeQuickAccess,
  getQuickAccessTab,
  getUiMode,
  isGamepadUIMode,
  isQuickAccessOpen,
  openDeckyPanel,
} from "./steam";

export interface HintSessionOptions {
  /** Called after a manual activation, `true` when the panel could be opened/closed. */
  onActivate?: (handled: boolean) => void;
}

export class HintSession {
  private readonly options: HintSessionOptions;
  private readonly modeListeners = new Set<(mode: HintMode) => void>();
  private readonly cleanups: Array<() => void> = [];
  private pollTimer: number | undefined;
  private mode: HintMode = "keyboard";
  private lastRequest = 0;
  private primed = false;
  private installing = false;
  /** Back-off when Steam's footer is momentarily unavailable. */
  private retryAt = 0;
  private disposed = false;

  constructor(options: HintSessionOptions = {}) {
    this.options = options;
  }

  start(): void {
    if (this.disposed) return;

    this.cleanups.push(
      subscribeConfig(() => {
        // Repaint/configure the injected pill without reinstalling it.
        void this.install();
      }),
    );

    void this.install();
    this.pollTimer = window.setInterval(() => {
      void this.tick();
    }, POLL_MS);

    report(`start uiMode=${getUiMode() ?? "?"} bigPicture=${isGamepadUIMode()}`);
  }

  stop(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelOpenFallback();
    if (this.pollTimer !== undefined) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    for (const cleanup of this.cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        /* keep tearing the rest down */
      }
    }
    this.modeListeners.clear();
    void removeHint();
  }

  getMode(): HintMode {
    return this.mode;
  }

  subscribeMode(listener: (mode: HintMode) => void): () => void {
    this.modeListeners.add(listener);
    return () => {
      this.modeListeners.delete(listener);
    };
  }

  /**
   * Opens Decky's panel, or closes it when it is already the panel on screen.
   * Returns true when the action could be issued.
   */
  activate(): boolean {
    if (!getConfig().enabled) return false;

    if (isQuickAccessOpen() && getQuickAccessTab() === DECKY_QAM_TAB) {
      cancelOpenFallback();
      const closed = closeQuickAccess();
      report(`activate -> close qam=${closed}`);
      this.options.onActivate?.(closed);
      return closed;
    }

    return this.openPanel();
  }

  /** Unconditional "show me Decky", used by the plugin's own panel button. */
  openPanel(): boolean {
    cancelOpenFallback();
    const requested = openDeckyPanel();
    report(`openPanel -> requested=${requested}`);
    this.options.onActivate?.(requested);
    return requested;
  }

  // --- internals ---------------------------------------------------------

  private async install(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.installing) return true;
    this.installing = true;
    try {
      const ok = await pushHint(getConfig());
      // The footer is rebuilt often (navigation, input mode): when it is not
      // there yet, wait a few seconds instead of hammering the CDP socket.
      this.retryAt = ok ? 0 : Date.now() + 3000;
      return ok;
    } finally {
      this.installing = false;
    }
  }

  private async tick(): Promise<void> {
    if (this.disposed) return;
    const state: PollState | null = await pollHint();
    if (!state) {
      // The tab was reloaded (UI mode switch) or the pill is gone: reinstall.
      void this.install();
      return;
    }

    if (state.mode !== this.mode) {
      this.mode = state.mode;
      for (const listener of this.modeListeners) {
        try {
          listener(this.mode);
        } catch {
          /* keep notifying the others */
        }
      }
    }

    // First successful read: adopt the counter instead of treating whatever the
    // page accumulated before the plugin started as a click.
    if (!this.primed) {
      this.primed = true;
      this.lastRequest = state.req;
      return;
    }

    if (state.req !== this.lastRequest) {
      if (state.req < this.lastRequest) {
        // Fresh page: the injected counter restarted.
        this.lastRequest = state.req;
        return;
      }
      this.lastRequest = state.req;
      if (!getConfig().enabled) return;
      report(`request ${state.req} -> activate`);
      this.activate();
      return;
    }

    // Steam rebuilt its footer (input mode change, view change): put the hint
    // back where it belongs, or remove it when the pad took over.
    const config = getConfig();
    const wanted = config.enabled && state.mode === "keyboard";
    if (state.pill !== wanted && Date.now() >= this.retryAt) {
      void this.install();
    }
  }
}
