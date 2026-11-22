import { executeInTab } from "@decky/api";
import { report } from "./api";

/**
 * Big Picture's left menu (Home / Library / Store / ... / Downloads / Settings / Power) is NOT
 * part of the "Steam Big Picture Mode" window: it lives in its own CEF window, whose title is
 * `MainMenu_uid<N>` (the N changes when Steam restarts). Its list is React-managed and not
 * exposed through routerHook, so the entry is a clone of the "Downloads" item, inserted right
 * after it, and a click is reported back to this realm through a counter.
 */

const PAGE_ROUTE = "/scskiller";
const BPM = "Steam Big Picture Mode";

const INSTALL = `(() => {
  if (window.__scskMenuInstalled) return "already";
  window.__scskMenuInstalled = true;
  window.__scskMenuClicks = window.__scskMenuClicks || 0;

  const labelIn = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if ((node.textContent || "").trim() === "Downloads") return node;
      node = walker.nextNode();
    }
    return null;
  };

  const insert = () => {
    const leaves = Array.from(document.querySelectorAll("div, span")).filter(
      (el) => el.children.length === 0 && (el.textContent || "").trim() === "Downloads",
    );
    if (!leaves.length) return "no-downloads";
    const leaf = leaves[0];

    // the label sits inside an icon+label row: climb until the siblings are menu ROWS
    // (the one after Downloads contains "Settings"), otherwise the clone lands sideways
    let row = leaf;
    for (let depth = 0; depth < 7; depth++) {
      const parent = row.parentElement;
      if (!parent) break;
      const siblings = Array.from(parent.children).filter((node) => node !== row);
      if (siblings.some((node) => /Settings/.test(node.textContent || ""))) break;
      row = parent;
    }
    if (!row || !row.parentElement) return "no-item";

    const existing = document.querySelector("[data-scsk-menu]");
    if (existing) {
      if (existing.parentElement === row.parentElement) return "present";
      existing.remove(); // a previous build inserted it at the wrong level
    }

    const clone = row.cloneNode(true);
    clone.setAttribute("data-scsk-menu", "1");
    // The climb above stops on the wrapper Steam puts around each entry, not always on the row
    // itself: the element the controller focuses is the role=menuitem node inside. Everything the
    // user sees or presses (label, aria, listeners, painting) has to go on THAT element, otherwise
    // the focus lands on an inner row that has no handler (measured 2026-11-22: the focus reached
    // the entry, A did nothing, and the row stayed grey).
    const menuitem = clone.matches('[role="menuitem"]') ? clone : clone.querySelector('[role="menuitem"]');
    const control = menuitem || clone;
    control.setAttribute("data-scsk-menu-item", "1");
    control.setAttribute("tabindex", "0");
    // the clone copies the aria-label of "Downloads"
    control.setAttribute("aria-label", "SCSKiller");
    // and, when Downloads happens to be the active page, its blue "current page" marker is copied
    // with it: this entry is not the active page, so any child that is neither the icon nor the
    // label is dropped (measured: the leftover bar is a div with no text, no svg, inline 10px width)
    for (const child of Array.from(control.children)) {
      if (!child.querySelector("svg") && !(child.textContent || "").trim()) child.remove();
    }
    const text = labelIn(control);
    if (!text) return "no-label";
    text.textContent = "SCSKiller";
    // Steam's icons are a 36x36 svg with several paths (the download one even nests a second
    // svg): replacing one path leaves the others, so swap the whole glyph for our bolt, scaled
    // from the 24x24 canvas to 36x36.
    const svg = control.querySelector("svg");
    if (svg) {
      const ns = "http://www.w3.org/2000/svg";
      const glyph = document.createElementNS(ns, "svg");
      glyph.setAttribute("xmlns", ns);
      glyph.setAttribute("viewBox", "0 0 36 36");
      glyph.setAttribute("fill", "none");
      if (svg.getAttribute("width")) glyph.setAttribute("width", svg.getAttribute("width"));
      if (svg.getAttribute("height")) glyph.setAttribute("height", svg.getAttribute("height"));
      if (svg.getAttribute("class")) glyph.setAttribute("class", svg.getAttribute("class"));
      const path = document.createElementNS(ns, "path");
      path.setAttribute(
        "d",
        "M19.5 3 6.75 19.8c-.6.75 0 1.95.9 1.95H15l-1.5 11.25L29.25 15c.6-.75 0-1.95-.9-1.95H21l1.5-10.05Z",
      );
      path.setAttribute("fill", "currentColor");
      glyph.appendChild(path);
      svg.replaceWith(glyph);
    }
    // A clone has no React state: Steam paints its own items from state, so a focused clone looks
    // exactly like an unfocused one and the user reports "I cannot select SCSKiller". The look is
    // painted here from the measured values of a focused native item that is NOT the current page:
    // background rgba(255,255,255,0.1), white label and glyph, and nothing else. The blue bar of
    // the rail marks the ACTIVE page (a separate Steam class), so a clone must not draw it - doing
    // that showed a blue bar on SCSKiller while another page was open (reported 2026-11-22).
    clone.classList.remove("gpfocus", "gpfocuswithin");
    control.classList.remove("gpfocus", "gpfocuswithin");
    const label = text.parentElement;
    const paint = (on) => {
      control.style.background = on ? "rgba(255, 255, 255, 0.1)" : "";
      // the glyph uses fill="currentColor", so the white has to reach the item itself
      control.style.color = on ? "#ffffff" : "";
      if (label) label.style.color = on ? "#ffffff" : "";
    };
    control.addEventListener("focus", () => paint(true));
    control.addEventListener("blur", () => paint(false));
    // Steam activates the element the gamepad focus sits on by dispatching vgp_onok on it; a
    // clone has no Focusable handler, so A did nothing (measured 2026-11-22: the focus reached
    // this entry, A was silent, the mouse click worked).
    const activate = () => {
      window.__scskMenuClicks += 1;
    };
    control.addEventListener("vgp_onok", activate);
    control.addEventListener("click", activate);
    row.parentElement.insertBefore(clone, row.nextSibling);
    return "inserted";
  };

  const observer = new MutationObserver(() => insert());
  observer.observe(document.body, { childList: true, subtree: true });
  window.__scskMenuOff = () => {
    observer.disconnect();
    const node = document.querySelector("[data-scsk-menu]");
    if (node) node.remove();
    window.__scskMenuInstalled = false;
  };
  insert();
  window.__scskMenuTick = setInterval(insert, 700);
  return "installed";
})()`;

/** The menu window title carries a counter: read the CEF target list, fall back to probing. */
async function menuTitle(): Promise<string | null> {
  try {
    const response = await fetch("http://localhost:8080/json");
    const targets = (await response.json()) as { title?: string }[];
    const found = targets.map((target) => target.title ?? "").find((title) => title.startsWith("MainMenu"));
    if (found) return found;
  } catch {
    // the plugin realm is usually not allowed to read the debug endpoint
  }
  // executeInTab needs the exact title and Steam numbers it: probe the plausible ones
  for (let index = 2; index <= 24; index++) {
    const candidate = `MainMenu_uid${index}`;
    try {
      const reply: any = await executeInTab(candidate, false, "1");
      if (reply?.success !== false) return candidate;
    } catch {
      // not this one
    }
  }
  return null;
}

export function installMenuEntry(open: () => void): () => void {
  let stopped = false;
  let seen = 0;
  let title: string | null = null;
  let ticks = 0;

  const ping = async () => {
    if (stopped) return;
    if (!title) {
      title = await menuTitle();
      if (!title) return;
      report(`menu: window is ${title}`);
    }
    try {
      // keep the entry alive (Steam re-renders the list) without hammering the window
      if (ticks % 8 === 0) {
        const res: any = await executeInTab(title, false, INSTALL);
        const state = String(res?.result ?? "");
        if (state === "installed") report("menu: entry injected under Downloads");
      }
      // the click itself is polled fast: it is what makes the page feel instant
      const clicksReply: any = await executeInTab(title, false, "String(window.__scskMenuClicks || 0)");
      const clicks = Number(clicksReply?.result ?? 0);
      if (clicks > seen) {
        seen = clicks;
        open();
      }
    } catch {
      title = null; // Steam restarted: resolve the new window name
    }
    ticks += 1;
  };

  ping();
  const timer = window.setInterval(ping, 250);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    if (title) {
      try {
        void executeInTab(title, false, "window.__scskMenuOff && window.__scskMenuOff()");
      } catch {
        // window gone
      }
    }
  };
}

/** Close Steam's side menus (the left menu stays open otherwise, a clone has no handler). */
function closeSideMenus(): void {
  try {
    const store = (window as any).SteamUIStore;
    const instance =
      (store?.GetFocusedWindowInstance && store.GetFocusedWindowInstance()) ||
      store?.WindowStore?.GamepadUIMainWindowInstance;
    instance?.MenuStore?.CloseSideMenus?.();
  } catch {
    // the menu closes on its own if the store moved
  }
}

/** The router follows the history of this realm (verified with a manual pushState). */
export function openPage(): void {
  closeSideMenus();
  try {
    window.history.pushState({}, "", PAGE_ROUTE);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  } catch (exc) {
    report(`page: could not navigate: ${String(exc)}`);
  }
}
