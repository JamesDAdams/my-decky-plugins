import { executeInTab, routerHook } from "@decky/api";
import { findInReactTree } from "@decky/ui";
import { gameState, getStatus, type Account, type GameState } from "./api";
import { report } from "./report";
import { requestAccountSwitch, requestSwitch } from "./switchAction";

/**
 * Two pages get a switch button from this plugin:
 *
 *  - a game page whose game belongs to another saved account: the native Borrow button is
 *    rewritten to "Switch account & Play" (label + every activation handler);
 *  - the account settings page (`/routes/account`): a "Switch to <persona> account" button is
 *    added to the right of Steam's Change Account button, same markup, same height.
 *
 * The plugin's own document is 1x1 (AGENTS.md rule 1) and the target DOM belongs to another
 * CEF frame, so both pages are handled through `executeInTab` into the visible window: the
 * nodes there carry their React props (`__reactProps$...`) and their fiber, which is enough to
 * take over a native button without redrawing Steam's UI.
 *
 * A click is reported back through a counter in that window (`window.__steamSwitch.asks`) that
 * this module polls; the payload says which account (or which game) to switch to.
 */

const ROUTE = "/library/app/:appid";
const WINDOW = "Steam Big Picture Mode";
const TICK_MS = 400;
const LABEL = "Switch account & Play";
const ACCOUNT_ROUTE = /\/account\/?$/;
const STATUS_TTL_MS = 5000;

type Ask = { kind?: string; appid?: number; owner?: number; account?: string; persona?: string; at?: number };
type AccountPageInfo = { accounts: Account[]; current: Account | null; at: number };

let ticker: ReturnType<typeof setInterval> | undefined;
let routePatch: any;
let pageInfo = { appid: 0, owner: 0 };
let mode: "game" | "account" | null = null;
let activeGame: { appid: number; info: GameState } | null = null;
let statusCache: AccountPageInfo | null = null;
let checkedKey = "";
let checkedAt = 0;
let loggedPoll = false;
let accountReported = "";

export function appidFromLocation(): number {
  try {
    const match = /\/library\/app\/(\d+)/.exec(String(window.location?.pathname || ""));
    if (match) return Number(match[1]);
  } catch {
    // no location: leave the page alone
  }
  return 0;
}

function jsRaw(script: string): Promise<any> {
  try {
    const result: any = executeInTab(WINDOW, false, script);
    if (result && typeof result.then === "function") return result;
    return Promise.resolve(result);
  } catch (exc) {
    report(`executeInTab: ${String(exc)}`);
    return Promise.resolve(null);
  }
}

/**
 * `executeInTab` resolves to `{success, result}` on this Decky build and to a plain string on
 * others: every answer goes through this reader.
 */
function asText(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    for (const key of ["result", "value", "text"]) {
      if (typeof (value as any)[key] === "string") return (value as any)[key];
    }
    const inner = (value as any).result;
    if (inner && typeof inner === "object" && typeof inner.value === "string") return inner.value;
  }
  return "";
}

// --------------------------------------------------------------------------- #
// scripts evaluated in the visible window
// --------------------------------------------------------------------------- #

const STATE = "var st = window.__steamSwitch || (window.__steamSwitch = { asks: [], active: false, appid: 0, owner: 0, label: '', installed: false }); if (!st.asks) { st.asks = []; } ";

function gameScript(appid: number, owner: number): string {
  return (
    "(() => { try {" +
    STATE +
    "st.page = 'game'; st.appid = " + appid + "; st.owner = " + owner + "; st.label = " + JSON.stringify(LABEL) + "; st.active = true;" +
    "if (st.installed) { return st.apply ? st.apply() : 'on'; }" +
    "st.installed = true;" +
    "st.handler = function (ev) {" +
    "try { if (ev && ev.stopPropagation) ev.stopPropagation(); if (ev && ev.preventDefault) ev.preventDefault(); } catch (e) {}" +
    "st.asks.push({ kind: 'game', appid: st.appid, owner: st.owner, at: Date.now() });" +
    "};" +
    "st.patchButton = function (el) {" +
    "try { var keys = Object.keys(el);" +
    "for (var i = 0; i < keys.length; i++) { var k = keys[i];" +
    "if (k.indexOf('__reactProps') === 0) {" +
    "var src = el[k] || {}; var props = {}; for (var p in src) { props[p] = src[p]; }" +
    "props.onClick = st.handler; props.onMouseUp = undefined; el[k] = props; }" +
    "if (k.indexOf('__reactFiber') === 0) {" +
    "var fiber = el[k];" +
    "for (var f = fiber, n = 0; f && n < 10; f = f.return, n++) {" +
    "var mp = f.memoizedProps;" +
    "if (mp && typeof mp.onClick === 'function') { try { mp.onClick = st.handler; mp.onMouseUp = undefined; } catch (e) {} }" +
    "} } } } catch (e) {}" +
    "};" +
    "st.apply = function () {" +
    "if (!st.active) { return 'inactive'; }" +
    "try {" +
    "var buttons = document.querySelectorAll('[role=\"button\"]'); var target = null;" +
    "for (var i = 0; i < buttons.length; i++) { var b = buttons[i]; var r = b.getBoundingClientRect();" +
    "if (r.width > 150 && r.width < 320 && r.height > 40 && r.height < 60) { target = b; break; } }" +
    "if (!target) { st.target = null; return 'nobutton'; }" +
    "if (target !== st.target) { st.target = target; st.patchButton(target); }" +
    "var label = target.firstElementChild;" +
    "if (label && (label.textContent || '').trim() !== st.label) { label.textContent = st.label; }" +
    "return 'ok';" +
    "} catch (e) { return 'apply-failed'; } };" +
    "if (!st.observer) {" +
    "st.observer = new MutationObserver(function () {" +
    "try { clearTimeout(st.timer); st.timer = setTimeout(function () { if (st.apply) { st.apply(); } }, 80); } catch (e) {}" +
    "});" +
    "st.observer.observe(document.body, { childList: true, subtree: true, characterData: true });" +
    "}" +
    "return st.apply();" +
    "} catch (e) { return 'install-failed'; } })()"
  );
}

function accountScript(current: string, others: { account: string; persona: string }[]): string {
  return (
    "(() => { try {" +
    STATE +
    "st.page = 'account'; st.active = false; st.currentAccount = " + JSON.stringify(current) + ";" +
    "st.others = " + JSON.stringify(others) + ";" +
    "var buttons = document.querySelectorAll('button[role=\"button\"]');" +
    "var row = null; var lowest = -1e9;" +
    "for (var i = 0; i < buttons.length; i++) {" +
    "var group = buttons[i].parentElement;" +
    "if (!group) { continue; }" +
    "var count = group.querySelectorAll('button[role=\"button\"]').length;" +
    "var grect = group.getBoundingClientRect();" +
    // the account row is the lowest short row of two or more buttons: Sign Out + Change Account
    // (three once this plugin added its own), and it sits below every other button row
    "if (count >= 2 && grect.height <= 60 && grect.bottom > lowest) { lowest = grect.bottom; row = group; } }" +    "if (!row) { return 'no-row'; }" +
    "var stale = document.querySelectorAll('[id^=\"steam-switch-account-\"]');" +
    "for (var s = 0; s < stale.length; s++) {" +
    "if (stale[s].parentElement !== row) { stale[s].remove(); } }" +
    "var reference = null;" +
    "for (var c = 0; c < row.children.length; c++) {" +
    "var child = row.children[c];" +
    "if (child.id && child.id.indexOf('steam-switch-account-') === 0) { continue; }" +
    "reference = child; }" +
    "if (!reference) { return 'no-reference'; }" +
    "for (var k = 0; k < st.others.length; k++) {" +
    "var acc = st.others[k]; var id = 'steam-switch-account-' + acc.account;" +
    "var btn = document.getElementById(id);" +
    "if (!btn) {" +
    "btn = reference.cloneNode(true); btn.id = id;" +
    // no quotes in the label; a long persona wraps and is clamped to two lines
    "btn.style.width = 'auto'; btn.style.maxWidth = '360px'; btn.style.minHeight = '40px'; btn.style.height = 'auto';" +
    "btn.style.whiteSpace = 'normal'; btn.style.lineHeight = '1.2'; btn.style.padding = '6px 18px';" +
    "btn.style.textAlign = 'center'; btn.style.overflow = 'hidden';" +
    "(function (entry) { btn.addEventListener('click', function (ev) {" +
    "try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}" +
    "st.asks.push({ kind: 'account', account: entry.account, persona: entry.persona, at: Date.now() });" +
    "}); })(acc);" +
    "row.appendChild(btn); }" +
    "var span = btn.firstElementChild;" +
    "if (!span || span.tagName !== 'SPAN') {" +
    "btn.textContent = ''; span = document.createElement('span');" +
    "span.style.cssText = 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-align:center';" +
    "btn.appendChild(span); }" +
    "var label = 'Switch to ' + acc.persona + ' account';" +
    "if ((span.textContent || '') !== label) { span.textContent = label; }" +
    "}" +
    "return 'ok';" +
    "} catch (e) { return 'fail'; } })()"
  );
}

function offScript(): string {
  return (
    "(() => { try { var st = window.__steamSwitch; if (!st) { return 'none'; }" +
    "st.active = false; st.installed = false; st.target = null;" +
    "if (st.observer) { st.observer.disconnect(); st.observer = null; }" +
    "return 'off'; } catch (e) { return 'fail'; } })()"
  );
}

function pollScript(): string {
  return (
    "(() => { try { var st = window.__steamSwitch;" +
    "if (!st || !st.asks || !st.asks.length) { return '[]'; }" +
    "var out = JSON.stringify(st.asks); st.asks.length = 0; return out;" +
    "} catch (e) { return '[]'; } })()"
  );
}

// --------------------------------------------------------------------------- #
// page sync
// --------------------------------------------------------------------------- #

async function status(): Promise<AccountPageInfo> {
  const now = Date.now();
  if (statusCache && now - statusCache.at < STATUS_TTL_MS) return statusCache;
  const reply = await getStatus();
  statusCache = {
    accounts: (reply && reply.accounts) || [],
    current: (reply && reply.current) || null,
    at: now,
  };
  return statusCache;
}

async function deactivate(): Promise<void> {
  if (!mode) return;
  mode = null;
  activeGame = null;
  await jsRaw(offScript());
}

async function syncGame(appid: number, owner: number): Promise<void> {
  if (!appid) return;
  if (activeGame && activeGame.appid === appid) {
    await jsRaw(gameScript(appid, owner));
    return;
  }
  const key = `game:${appid}:${owner}`;
  const now = Date.now();
  if (key === checkedKey && now - checkedAt < 5000) return;
  checkedKey = key;
  checkedAt = now;

  let info: GameState;
  try {
    info = await gameState(appid, owner || undefined);
  } catch (exc) {
    report(`game_state ${appid}: ${String(exc)}`);
    return;
  }
  if (!info || !info.can_switch) {
    if (mode === "game") await deactivate();
    return;
  }
  const result = asText(await jsRaw(gameScript(appid, owner)));
  activeGame = { appid, info };
  mode = "game";
  report(`borrowed ${appid}: owner ${info.owner?.account || "?"} -> ${info.target?.account || "?"} (${result})`);
}

async function syncAccount(): Promise<void> {
  let info: AccountPageInfo;
  try {
    info = await status();
  } catch (exc) {
    report(`account page status: ${String(exc)}`);
    return;
  }
  const others = info.accounts.filter((account) => !info.current || account.id64 !== info.current.id64);
  if (!others.length) {
    if (mode === "account") await deactivate();
    return;
  }
  const script = accountScript(
    info.current ? info.current.account : "",
    others.map((account) => ({ account: account.account, persona: account.persona || account.account })),
  );
  const result = asText(await jsRaw(script));
  mode = "account";
  activeGame = null;
  if (result !== "ok" && result !== accountReported) {
    accountReported = result;
    report(`account page: ${result}`);
  }
}

async function poll(): Promise<void> {
  const raw = asText(await jsRaw(pollScript()));
  if (!loggedPoll) {
    loggedPoll = true;
    report(`poll raw: ${JSON.stringify(raw)?.slice(0, 200)}`);
  }
  if (!raw || raw === "[]") return;
  let asks: Ask[] = [];
  try {
    asks = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(asks)) return;
  for (const ask of asks) {
    if (!ask) continue;
    if (ask.kind === "account" && ask.account) {
      requestAccountSwitch(String(ask.account), String(ask.persona || ask.account));
    } else if (ask.appid && activeGame) {
      requestSwitch(activeGame.appid, activeGame.info);
    }
  }
}

function tick(): void {
  const route = String(window.location?.pathname || "");
  const appid = appidFromLocation();
  if (appid) {
    if (pageInfo.appid !== appid) pageInfo = { appid, owner: 0 };
    void syncGame(appid, pageInfo.owner);
  } else if (ACCOUNT_ROUTE.test(route)) {
    void syncAccount();
  } else {
    void deactivate();
  }
  void poll();
}

/** Read the page's `overview` from the shared route tree (appid + owning account id). */
function readOverview(tree: any): void {
  try {
    const element: any = findInReactTree(tree, (node: any) => !!node?.props?.overview);
    const overview = element?.props?.overview;
    if (!overview) return;
    const appid = Number(overview.appid || 0);
    if (!appid) return;
    pageInfo = { appid, owner: Number(overview.owner_account_id || 0) };
  } catch {
    // no overview on this page
  }
}

export function installGamePageWatcher(): () => void {
  try {
    routePatch = routerHook.addPatch(ROUTE, (tree: any) => {
      readOverview(tree);
      return tree;
    });
  } catch (exc) {
    report(`route watcher: ${String(exc)}`);
  }

  if (!ticker) {
    ticker = setInterval(tick, TICK_MS);
    tick();
  }

  return () => {
    if (ticker) {
      clearInterval(ticker);
      ticker = undefined;
    }
    try {
      if (routePatch) routerHook.removePatch(ROUTE, routePatch);
    } catch {
      // loader shutting down
    }
    routePatch = undefined;
    activeGame = null;
    mode = null;
    void jsRaw(offScript());
  };
}
