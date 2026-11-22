import { report } from "./report";
import { adopt, nodeFor, walkNodes } from "./navAdopt";

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

  const doc = downloads.ownerDocument;
  const item = [...doc.querySelectorAll("div")].find((element) => {
    const box = element.getBoundingClientRect();
    return (
      typeof element.className === "string" &&
      element.className.includes("Panel Focusable") &&
      (element.textContent ?? "").trim() === "SCSKiller" &&
      box.width > 200 &&
      box.width < 300
    );
  }) as HTMLElement | undefined;
  if (!item) return;
  if (nodeFor(item)) return;
  if (adopt(item, parent, template)) say("menu: entry adopted into the sidebar focus group");
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
