import { report as backendReport } from "./api";

/**
 * Never-throwing diagnostic channel: the plugin's own document is a 1x1 page, so the only
 * place a diagnosis can be read is `homebrew/logs/SteamSwitch/<date>.log` (AGENTS.md rule 7).
 */
export function report(message: string): void {
  try {
    const result: any = backendReport(String(message).slice(0, 1500));
    if (result && typeof result.catch === "function") result.catch(() => undefined);
  } catch {
    // logging must never break the UI
  }
}
