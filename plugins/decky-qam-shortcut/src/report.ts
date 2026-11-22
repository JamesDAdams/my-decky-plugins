import { callable } from "@decky/api";

const reportCall = callable<[message: string], void>("report");

/**
 * Writes one line to the plugin's backend log, which lives on disk:
 *   Windows: %USERPROFILE%\homebrew\logs\decky-qam-shortcut\*.log
 *   SteamOS: /home/deck/homebrew/logs/decky-qam-shortcut/*.log
 *
 * Never throws: diagnostics must never be the reason the plugin stops working.
 */
export function report(message: string): void {
  try {
    const pending = reportCall(message) as unknown as Promise<void> | undefined;
    if (pending && typeof (pending as any).catch === "function") {
      (pending as any).catch(() => {
        /* backend not reachable: ignore */
      });
    }
  } catch {
    /* ignore */
  }
}
