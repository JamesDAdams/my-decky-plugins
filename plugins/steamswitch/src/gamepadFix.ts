import { adopt, nodeFor, walkNodes } from "./navAdopt";
import { report } from "./report";

/**
 * The "Switch to <persona> account" buttons are DOM clones appended to Steam's own button row
 * (that is the only way to get the exact native look). A DOM clone is not in Big Picture's gamepad
 * navigation tree, so a controller cannot reach it: the mouse can, the gamepad cannot.
 *
 * Steam's tree is reachable from here (`SteamUIStore.NavigationManager`), so each clone is given a
 * node copied from the native Change Account button, inserted in the same row. The row is a focus
 * group like any other: once the node is there, Left/Right lands on our buttons exactly like on
 * Sign Out and Change Account. `plugins/scskiller/tools/nav-audit.mjs` prints that tree.
 */

const CHANGE = /change account|changer de compte/i;
const ID_PREFIX = "steam-switch-account-";

let lastReport = "";

function say(message: string): void {
  if (message === lastReport) return;
  lastReport = message;
  report(`gamepad: ${message}`);
}

export function adoptAccountButtons(): void {
  try {
    const found: { native: HTMLElement | null } = { native: null };
    walkNodes((_node, element) => {
      if (element.tagName === "BUTTON" && CHANGE.test((element.textContent ?? "").trim())) {
        found.native = element as HTMLElement;
        return true;
      }
    });
    const native = found.native;
    if (!native) {
      say("account page: native Change Account button not found");
      return;
    }

    const parent = nodeFor(native)?.m_Parent ?? null;
    const template = nodeFor(native);
    if (!parent || !template) {
      say("account page: native button has no navigation node");
      return;
    }

    const doc = native.ownerDocument;
    const ours = [...doc.querySelectorAll(`[id^="${ID_PREFIX}"]`)] as HTMLElement[];
    let added = 0;
    for (const button of ours) {
      if (nodeFor(button)) continue;
      if (adopt(button, parent, template)) added += 1;
    }
    if (added) say(`account page: ${added} switch button(s) made gamepad reachable`);
  } catch {
    // a focus fix must never break the page
  }
}
