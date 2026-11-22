import { report } from "./report";
import { adopt, nodeFor, uiDocument, walkNodes, type NavNode } from "./navAdopt";

/**
 * Keep the controls this plugin draws inside Steam's gamepad focus groups.
 *
 * Two things need it:
 *  - the 48x48 button over the play bar: React registers its navigation node under the page
 *    container (that is the React parent of the overlay), so the node is moved under the icon row,
 *    the group the controller walks with Left/Right. The button element is rendered once, so the
 *    node survives re-renders and the move is not lost;
 *  - the "SCSKiller" entry of the left menu: Steam's sidebar only gives focus to the entries it
 *    built from its own page objects, so the entry is adopted from the Downloads entry next to it.
 *
 * Everything is idempotent, and every claim is measured with tools/nav-audit.mjs (focus parent of
 * an element) and tools/nav-pad.mjs (virtual D-pad press + focused element).
 */

const INTERVAL_MS = 150;

let timer: ReturnType<typeof setInterval> | undefined;
let lastReport = "";
let moves = 0;

function say(message: string): void {
  if (message === lastReport) return;
  lastReport = message;
  report(`gamepad: ${message}`);
}

function fixGamePageButton(): void {
  // Disabled on purpose. Moving the node after registration reorders the icon row and traps the
  // focus (measured with a controller: Down lands on the SCSKiller button before Play, and no
  // direction leaves it). The React-side insertion is the only correct fix; until then the button
  // stays mouse-only instead of breaking the page.
}

function fixMenuEntry(): void {
  const found: { downloads: HTMLElement | null } = { downloads: null };
  walkNodes((_node, element) => {
    if (
      element.tagName === "DIV" &&
      typeof element.className === "string" &&
      element.className.includes("Panel Focusable") &&
      (element.textContent ?? "").trim() === "Downloads"
    ) {
      found.downloads = element as HTMLElement;
      return true;
    }
  });
  const downloads = found.downloads;
  if (!downloads) return;

  const template = nodeFor(downloads);
  const parent = template?.m_Parent ?? null;
  if (!template || !parent) return;

  // the entry is a DOM clone built by bpmMenu.ts: the element to focus is the one it marked
  const doc = downloads.ownerDocument;
  const item = doc.querySelector("[data-scsk-menu-item]") as HTMLElement | null;
  if (!item) return;

  // Steam re-renders the list and bpmMenu.ts has to rebuild the clone: the previous node then
  // points at a DETACHED element, and such a node still answers GetFocusable() = "self", so the
  // D-pad stalls on nothing (measured 2026-11-22: six Down presses in a row left the focus on
  // Home). Only our own dead entries are removed, and only from the sidebar group.
  const children: NavNode[] = Array.isArray(parent.m_rgChildren) ? parent.m_rgChildren : [];
  const isOurs = (element: HTMLElement | null | undefined): boolean =>
    Boolean(element && (element.hasAttribute?.("data-scsk-menu") || element.closest?.("[data-scsk-menu]")));
  for (const node of [...children]) {
    const element = node?.m_element as HTMLElement | null | undefined;
    if (!element || element === item || !isOurs(element) || element.isConnected !== false) continue;
    try {
      const index = children.indexOf(node);
      if (index >= 0) children.splice(index, 1);
      node.m_Parent = null;
      parent.m_bChildrenSorted = false;
    } catch {
      // a node we cannot detach: the next tick retries
    }
  }

  // the node is appended after its template and left there: re-sorting the group by hand froze
  // the whole rail (measured 2026-11-22: with the reorder + EnsureChildrenSorted(), no direction
  // moved the focus any more; Steam resolves the order from the geometry instead)
  if (nodeFor(item)) return;
  if (adopt(item, parent, template)) say("menu: entry adopted into the sidebar focus group");
}

function fixPlayBarCancel(): void {
  // the compile overlay's Cancel ("x") next to the Play/Resume button: injected DOM in the visible
  // window, so it needs an adopted node or the controller cannot move onto it (reported 2026-11-22)
  const doc = uiDocument();
  if (!doc) return;
  const cancel = doc.querySelector("[data-scsk-cancel]") as HTMLElement | null;
  if (!cancel || !cancel.parentElement) return;
  const parent = nodeFor(cancel.parentElement);
  if (!parent) return;
  const manage = doc.querySelector('[aria-label="Manage"]') as HTMLElement | null;
  const template = manage ? nodeFor(manage) : null;
  if (!template) return;

  // a rebuilt overlay leaves a node on a detached element, which stalls the row
  const children: NavNode[] = Array.isArray(parent.m_rgChildren) ? parent.m_rgChildren : [];
  for (const node of [...children]) {
    const element = node?.m_element as HTMLElement | null | undefined;
    if (!element || element === cancel || !element.hasAttribute?.("data-scsk-cancel")) continue;
    try {
      const index = children.indexOf(node);
      if (index >= 0) children.splice(index, 1);
      node.m_Parent = null;
      parent.m_bChildrenSorted = false;
    } catch {
      // next tick retries
    }
  }

  if (nodeFor(cancel)) return;
  if (adopt(cancel, parent, template)) say("play bar: cancel button made gamepad reachable");
}

export function installGamepadFix(): () => void {
  if (timer) return () => undefined;
  const tick = () => {
    try {
      fixGamePageButton();
    } catch {
      // a focus fix must never break the UI
    }
    try {
      fixMenuEntry();
    } catch {
      // same
    }
    try {
      fixPlayBarCancel();
    } catch {
      // same
    }
  };
  tick();
  timer = setInterval(tick, INTERVAL_MS);
  return () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
}
