import { report } from "./report";
import { adopt, nodeFor, walkNodes, type NavNode } from "./navAdopt";

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
  // D-pad stops on nothing and the whole menu stops moving (measured 2026-11-22: a dead node in
  // the middle of the sidebar group froze Up/Down on Home). Only the sidebar group is touched.
  const children: NavNode[] = Array.isArray(parent.m_rgChildren) ? parent.m_rgChildren : [];
  for (const node of [...children]) {
    const element = node?.m_element as HTMLElement | null | undefined;
    const dead = Boolean(element) && element!.isConnected === false;
    const replaced = Boolean(element && element !== item && element.hasAttribute?.("data-scsk-menu-item"));
    if (!dead && !replaced) continue;
    try {
      const index = children.indexOf(node);
      if (index >= 0) children.splice(index, 1);
      node.m_Parent = null;
      parent.m_bChildrenSorted = false;
    } catch {
      // a node we cannot detach: the next tick retries
    }
  }

  let node = nodeFor(item);
  if (!node) {
    node = adopt(item, parent, template);
    if (!node) return;
    say("menu: entry adopted into the sidebar focus group");
  }
  // tree order must follow the DOM order (the clone sits right after Downloads), otherwise the
  // traversal reads a stale index: put the node after its template and let Steam re-sort
  try {
    const index = children.indexOf(node);
    if (index >= 0) children.splice(index, 1);
    const after = children.indexOf(template);
    children.splice(after >= 0 ? after + 1 : children.length, 0, node);
    parent.m_bChildrenSorted = false;
    if (typeof parent.EnsureChildrenSorted === "function") parent.EnsureChildrenSorted();
  } catch {
    // ordering is a nicety; the node is still reachable
  }
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
  };
  tick();
  timer = setInterval(tick, INTERVAL_MS);
  return () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
}
