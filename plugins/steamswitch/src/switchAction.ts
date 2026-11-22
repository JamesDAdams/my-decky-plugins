import { executeInTab, toaster } from "@decky/api";
import { switchAccount, switchAndPlay, type GameState, type SwitchReply } from "./api";
import { report } from "./report";

/**
 * The visible part of a switch: Steam is about to be torn down (it restarts signed into the
 * other account), so the feedback has to be painted into the visible window and has to
 * survive the moment the plugin's own document goes away.
 */

const OVERLAY_ID = "steam-switch-overlay";
const WINDOW = "Steam Big Picture Mode";
const GAME_NOTE = "Steam restarts, then launches the game";
const ACCOUNT_NOTE = "Steam restarts signed in as this account";

let inFlight = false;
let askedAt = 0;

function overlayScript(title: string, line: string, note: string): string {
  const data = JSON.stringify({ title, line, note });
  return (
    "(() => { try {" +
    "const data = " + data + ";" +
    "let host = document.getElementById('" + OVERLAY_ID + "');" +
    "if (!host) { host = document.createElement('div'); host.id = '" + OVERLAY_ID + "';" +
    "host.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;" +
    "display:flex;align-items:center;justify-content:center;background:#0b0e14;color:#ffffff;" +
    "font-family:Arial,Helvetica,sans-serif;text-align:center';" +
    "document.body.appendChild(host); }" +
    "host.textContent = '';" +
    "const box = document.createElement('div');" +
    "const head = document.createElement('div');" +
    "head.textContent = data.title;" +
    "head.style.cssText = 'font-size:30px;font-weight:600;margin-bottom:12px';" +
    "const text = document.createElement('div');" +
    "text.textContent = data.line;" +
    "text.style.cssText = 'font-size:20px;opacity:0.85';" +
    "box.appendChild(head); box.appendChild(text);" +
    "if (data.note) { const extra = document.createElement('div');" +
    "extra.textContent = data.note;" +
    "extra.style.cssText = 'font-size:15px;opacity:0.55;margin-top:16px'; box.appendChild(extra); }" +
    "host.appendChild(box);" +
    "} catch (error) {} })()"
  );
}

function hideScript(): string {
  return (
    "(() => { try { const host = document.getElementById('" + OVERLAY_ID + "');" +
    "if (host && host.parentNode) host.parentNode.removeChild(host); } catch (error) {} })()"
  );
}

function paint(script: string): void {
  try {
    const result: any = executeInTab(WINDOW, false, script);
    if (result && typeof result.catch === "function") result.catch(() => undefined);
  } catch (exc) {
    report(`overlay: ${String(exc)}`);
  }
}

export function showOverlay(persona: string, note: string): void {
  paint(overlayScript("Switching Steam account", persona, note));
}

export function hideOverlay(): void {
  paint(hideScript());
}

/** One switch at a time, and not twice for a double click. */
function begin(): boolean {
  if (inFlight) return false;
  const now = Date.now();
  if (now - askedAt < 2000) return false;
  askedAt = now;
  inFlight = true;
  return true;
}

function settle(reply: SwitchReply | undefined, fallback: string): void {
  if (reply && reply.ok) {
    // Steam is going down on purpose: the overlay is the feedback until it restarts
    report(`switch asked: ${JSON.stringify(reply).slice(0, 400)}`);
    return;
  }
  inFlight = false;
  hideOverlay();
  const message = String((reply && reply.error) || fallback);
  toaster.toast({ title: "Steam Switch", body: message, critical: false });
  report(`switch refused: ${message}`);
}

function fail(exc: unknown): void {
  inFlight = false;
  hideOverlay();
  toaster.toast({ title: "Steam Switch", body: String(exc), critical: false });
  report(`switch failed: ${String(exc)}`);
}

/** Borrowed game: sign into the owning account, then launch the game there. */
export function requestSwitch(appid: number, info: GameState): void {
  if (!begin()) return;
  const target = info.target;
  showOverlay(target ? target.persona || target.account : "the other account", GAME_NOTE);
  switchAndPlay(appid, info.owner?.id32 ?? undefined)
    .then((reply) => settle(reply, "could not switch account"))
    .catch(fail);
}

/** Account settings page: sign into another remembered account, nothing else. */
export function requestAccountSwitch(account: string, persona: string): void {
  if (!begin()) return;
  showOverlay(persona || account, ACCOUNT_NOTE);
  switchAccount(account)
    .then((reply) => settle(reply, "could not switch account"))
    .catch(fail);
}
