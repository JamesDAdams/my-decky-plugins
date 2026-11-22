/**
 * Bridge between the plugin (which runs in Decky's 1x1 "SharedJSContext"
 * window) and the window the user can actually see ("Steam Big Picture Mode").
 *
 * Why this exists: on desktop Steam, Decky loads plugin frontends in a hidden
 * 1x1 CEF browser. Anything drawn in `document` there is invisible, and no key
 * pressed by the user ever reaches it. Decky exposes `executeInTab`, which runs
 * JS in another CEF tab through the DevTools protocol, so the hint is installed
 * by injecting a self-contained script into the Big Picture tab. Clicks and the
 * keyboard shortcut cannot call back into this context, so the injected script
 * bumps a counter that we poll and act on.
 *
 * Design: the hint is not styled by hand. It is a clone of one of Steam's own
 * footer legend items (keycap + label), so it looks exactly like "F9 OPTIONS"
 * in every language and survives Steam visual updates, and it is inserted right
 * before the right-hand legend group, i.e. immediately left of F9 OPTIONS.
 */
import { executeInTab } from "@decky/api";

import type { HintConfig } from "./config";
import { report } from "./report";

export type HintMode = "gamepad" | "keyboard";

/** Title of the visible Big Picture browser window (CEF target title). */
const PRIMARY_TAB = "Steam Big Picture Mode";
/** Other titles seen across Steam versions / platforms. */
const TAB_CANDIDATES = [PRIMARY_TAB, "SP", "Steam"];

const VERSION = 4;
const POLL_MS = 700;

export interface PollState {
  req: number;
  pill: boolean;
  mode: HintMode;
  width: number;
  height: number;
}

/** Tab that worked last time, so we do not re-probe on every poll. */
let knownTab: string | null = null;
/** Last refusal reason, so a footer that is momentarily gone does not spam the log. */
let lastRefusal = "";

/**
 * Injected into the Big Picture window. Must stay fully self-contained: it is
 * serialised with Function.prototype.toString and evaluated in another context,
 * so it may not reference anything from this module.
 */
function installPill(cfg: any): string {
  var ID = "decky-qam-hint";
  var STATE = "__DECKY_HINT_STATE__";

  if (window.innerWidth < 200 || window.innerHeight < 200) {
    return JSON.stringify({ ok: false, reason: "small-window" });
  }

  var state = (window as any)[STATE];

  // Listeners are installed once per page.
  if (!state) {
    state = { mode: "keyboard", cfg: cfg, listeners: [], registration: null };
    (window as any)[STATE] = state;

    var onKeyDown = function (event: any) {
      var pressed = String(event.key || "").toLowerCase();
      if (pressed === "control" || pressed === "shift" || pressed === "alt" || pressed === "meta") return;
      state.mode = "keyboard";
      if (!state.cfg || !state.cfg.enabled) return;
      if (event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        if (pressed === "2" || event.code === "Digit2") {
          event.preventDefault();
          event.stopPropagation();
          (window as any).__DECKY_HINT_REQ__ = ((window as any).__DECKY_HINT_REQ__ | 0) + 1;
        }
      }
    };
    var onPointer = function () {
      state.mode = "keyboard";
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("mousemove", onPointer, true);
    state.listeners.push(["keydown", onKeyDown], ["pointerdown", onPointer], ["mousemove", onPointer]);

    try {
      var input = (window as any).SteamClient && (window as any).SteamClient.Input;
      if (input && input.RegisterForControllerInputMessages) {
        state.registration = input.RegisterForControllerInputMessages(function () {
          state.mode = "gamepad";
        });
      }
    } catch (e) {
      /* keyboard-only detection is enough */
    }
  }

  state.cfg = cfg;

  var existing = document.getElementById(ID);
  var wantItem = !!cfg.enabled && state.mode === "keyboard";

  if (!wantItem) {
    if (existing) existing.remove();
    return JSON.stringify({ ok: true, showing: false, mode: state.mode });
  }

  if (existing && existing.isConnected) {
    var cap = existing.querySelector('[role="img"]');
    var capText = cap && (cap.querySelector('[aria-hidden="true"] > div') || cap.querySelector("div"));
    if (capText) capText.textContent = cfg.label || "Ctrl+2";
    if (cap) cap.setAttribute("aria-label", cfg.label || "Ctrl+2");
    var label = existing.children[1];
    if (label) label.textContent = "DECKY";
    return JSON.stringify({ ok: true, showing: true, reused: true });
  }

  // Find one of Steam's own legend items (keycap "role=img" + text label) that
  // sits in the footer, and use it as the template.
  var template: HTMLElement | null = null;
  var images = document.querySelectorAll('[role="img"]');
  for (var i = 0; i < images.length; i++) {
    var img = images[i] as HTMLElement;
    var rect = img.getBoundingClientRect();
    if (rect.width < 6 || rect.height < 6 || rect.top < window.innerHeight * 0.8) continue;
    var node: HTMLElement | null = img.parentElement;
    for (var depth = 0; depth < 5 && node; depth++) {
      var parent: HTMLElement | null = node.parentElement;
      if (node.children.length === 2 && parent && parent.children.length >= 2) {
        template = node;
        break;
      }
      node = parent;
    }
  }
  if (!template) return JSON.stringify({ ok: false, reason: "no-footer-item" });

  var clone = template.cloneNode(true) as HTMLElement;
  clone.id = ID;
  clone.setAttribute("role", "button");
  clone.setAttribute("tabindex", "-1");
  clone.setAttribute("aria-label", "Ouvrir le panneau Decky (Ctrl+2)");
  clone.title = "Ouvrir le panneau Decky (Ctrl+2)";

  var cloneCap = clone.querySelector('[role="img"]');
  if (cloneCap) {
    cloneCap.setAttribute("aria-label", cfg.label || "Ctrl+2");
    var cloneCapText = cloneCap.querySelector('[aria-hidden="true"] > div') || cloneCap.querySelector("div");
    if (cloneCapText) cloneCapText.textContent = cfg.label || "Ctrl+2";
  }
  var cloneLabel = clone.children[1];
  if (cloneLabel) cloneLabel.textContent = "DECKY";

  clone.addEventListener("click", function (event: any) {
    event.preventDefault();
    event.stopPropagation();
    if (!state.cfg || !state.cfg.enabled) return;
    (window as any).__DECKY_HINT_REQ__ = ((window as any).__DECKY_HINT_REQ__ | 0) + 1;
  });

  var row = template.parentElement as HTMLElement;
  var children = Array.prototype.slice.call(row.children) as HTMLElement[];
  var spacer = -1;
  for (var k = 0; k < children.length; k++) {
    if ((children[k].textContent || "").trim() === "") {
      spacer = k;
      break;
    }
  }
  var before: HTMLElement | null = spacer >= 0 ? children[spacer + 1] : null;
  if (!before) before = children[children.length - 1] || null;
  row.insertBefore(clone, before);

  var placed = clone.getBoundingClientRect();
  return JSON.stringify({
    ok: true,
    showing: true,
    inserted: true,
    rect: [Math.round(placed.width), Math.round(placed.height), Math.round(placed.left), Math.round(placed.top)],
    rowKids: children.length,
  });
}

function pollPill(): string {
  var state = (window as any).__DECKY_HINT_STATE__;
  return JSON.stringify({
    req: (window as any).__DECKY_HINT_REQ__ | 0,
    pill: !!document.getElementById("decky-qam-hint"),
    mode: (state && state.mode) || "keyboard",
    w: window.innerWidth,
    h: window.innerHeight,
  });
}

function destroyPill(): string {
  var ID = "decky-qam-hint";
  var STATE = "__DECKY_HINT_STATE__";
  var el = document.getElementById(ID);
  if (el) el.remove();
  var state = (window as any)[STATE];
  if (state) {
    for (var i = 0; i < state.listeners.length; i++) {
      try {
        window.removeEventListener(state.listeners[i][0], state.listeners[i][1], true);
      } catch (e) {
        /* ignore */
      }
    }
    try {
      if (state.registration && state.registration.unregister) state.registration.unregister();
    } catch (e) {
      /* ignore */
    }
    (window as any)[STATE] = null;
  }
  return "destroyed";
}

async function runInTab(tab: string, code: string): Promise<{ success: boolean; result: any }> {
  try {
    const res = (await executeInTab(tab, false, code)) as { success: boolean; result: any };
    return res ?? { success: false, result: "no response" };
  } catch (error) {
    return { success: false, result: String(error) };
  }
}

/** Installs, refreshes or removes the hint in the visible Big Picture window. */
export async function pushHint(config: HintConfig): Promise<boolean> {
  const code = `(${installPill.toString()})(${JSON.stringify({
    version: VERSION,
    enabled: config.enabled,
    label: config.label || "Ctrl+2",
  })})`;

  const order = knownTab ? [knownTab, ...TAB_CANDIDATES.filter((t) => t !== knownTab)] : TAB_CANDIDATES;
  for (const tab of order) {
    const res = await runInTab(tab, code);
    if (!res.success) continue;
    const answer = String(res.result ?? "");
    if (answer.indexOf('"ok":true') === -1) {
      // Right title but wrong window (small viewport) — try the next candidate.
      if (answer.indexOf("small-window") !== -1) continue;
      if (answer !== lastRefusal) {
        lastRefusal = answer;
        report(`inject refused tab=${tab} ${answer}`);
      }
      return false;
    }
    knownTab = tab;
    lastRefusal = "";
    report(`inject ok tab=${tab} ${answer}`);
    return true;
  }
  report("inject failed: no big-picture tab accepted the script");
  return false;
}

/** Reads the injected hint's state (request counter + input mode). */
export async function pollHint(): Promise<PollState | null> {
  if (!knownTab) return null;
  const res = await runInTab(knownTab, `(${pollPill.toString()})()`);
  if (!res.success || typeof res.result !== "string") return null;
  try {
    const parsed = JSON.parse(res.result);
    return {
      req: Number(parsed.req) || 0,
      pill: !!parsed.pill,
      mode: parsed.mode === "gamepad" ? "gamepad" : "keyboard",
      width: Number(parsed.w) || 0,
      height: Number(parsed.h) || 0,
    };
  } catch {
    return null;
  }
}

/** Removes the hint (plugin unload / disable). */
export async function removeHint(): Promise<void> {
  if (!knownTab) return;
  await runInTab(knownTab, `(${destroyPill.toString()})()`);
}

export { POLL_MS, VERSION };
