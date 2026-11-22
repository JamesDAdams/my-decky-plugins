import { report } from "./report";
import { adopt, moveUnder, nodeFor, uiDocument, walkNodes } from "./navAdopt";

/**
 * Keep the controls this plugin draws inside Steam's gamepad focus groups.
 *
 * Two things need it:
 *  - the 48x48 button over the play bar: React registers its navigation node under the page
 *    container (the overlay is a child of the content column), so the node has to be moved under
 *    the icon row - the group the controller walks with Left/Right;
 *  - the "SCSKiller" entry of the left menu: Steam's sidebar only gives focus to the entries it
 *    built from its own page objects, so the entry may exist in the DOM without a navigation node
 *    and is adopted from the Downloads entry next to it.
 *
 * Both fixes are idempotent and cheap, and both are verified with tools/nav-audit.mjs, which
 * prints the focus parent of a selected element.
 */

const INTERVAL_MS = 1200;

let timer: ReturnType<typeof setInterval> | undefined;
let lastReport = "";

function say(message: string): void {
  if (message === lastReport) return;
  lastReport = message;
  report(`gamepad: ${message}`);
}

function fixGamePageButton(): void {
  const doc = uiDocument();
  if (!doc) return;
  const button = doc.querySelector('[data-scskiller="overlay"] div[role="button"]') as HTMLElement | null;
  if (!button) return;

  const controller = doc.querySelector('[aria-label="Configure Controller"]') as HTMLElement | null;
  const row = controller?.parentElement?.parentElement ?? null;
  if (!row) {
    say("game page: icon row not found");
    return;
  }

  const rowNode = nodeFor(row);
  const buttonNode = nodeFor(button);
  if (!rowNode) {
    say("game page: the icon row has no navigation node");
    return;
  }
  if (!buttonNode) {
    say("game page: the button has no navigation node");
    return;
  }
  if (moveUnder(buttonNode, rowNode)) say("game page: button moved into the icon row");
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

  // the entry lives in the left menu document, as a 240 px item next to the native ones
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
  if (nodeFor(item)) return; // Steam already registered it
  if (adopt(item, parent, template)) say("menu: entry adopted into the sidebar focus group");
}

export function installGamepadFix(): () => void {
  if (timer) return () => undefined;
  const tick = () => {
    try {
      fixGamePageButton();
    } catch {
      // a different Steam build: never break the UI for a focus fix
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
