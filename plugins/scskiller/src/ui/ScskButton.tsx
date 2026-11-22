import { showModal } from "@decky/ui";
import { ScskModal } from "./ScskModal";

/**
 * The game page button and the modal it opens.
 *
 * The button itself is not a React component any more: it is a copy of Steam's own icon in the play
 * bar (see `gamePageTree.tsx`), because only an element that Steam's navigation tree knows about can
 * be reached with a controller. This module keeps the shared state - which game the page shows - and
 * the one action the button performs.
 */

export let activeAppid = 0;

export function setActiveAppid(appid: number): void {
  activeAppid = appid;
}

/** The SCSKiller bolt, the same path the plugin icon uses. */
export const SCSK_ICON_PATH = "M13 2 4.5 13.2c-.4.5 0 1.3.6 1.3H10l-1 7.5L19.5 10c.4-.5 0-1.3-.6-1.3H14l1-6.7Z";

/** A gamepad A press and a mouse click can both arrive: only open once. */
let lastOpenAt = 0;

export function openScsk(): void {
  const now = Date.now();
  if (now - lastOpenAt < 500) return;
  const appid = activeAppid;
  if (!appid) return;
  if (typeof showModal !== "function") {
    console.warn("[SCSKiller] Steam's showModal is unavailable; the QAM panel still works");
    return;
  }
  lastOpenAt = now;
  let handle: { Close: () => void } | null = null;
  handle = showModal(<ScskModal appid={appid} onClose={() => handle?.Close()} />, undefined, {
    strTitle: "SCSKiller",
    bHideMainWindowForPopouts: true,
  });
}
