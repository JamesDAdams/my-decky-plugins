import { Focusable, showModal } from "@decky/ui";
import type { CSSProperties } from "react";
import { ScskIcon } from "./ScskIcon";
import { ScskModal } from "./ScskModal";

/**
 * The compact SCSKiller button of the game page (left of the controller icon).
 *
 * It deliberately has **no React state**: every re-render makes Decky's Focusable register its
 * navigation node again, which lands under the page container instead of the icon row, and a
 * controller user then walks past the button. Focus and hover are pure CSS here, and the status
 * dot is painted by `dot.ts` straight on the DOM element.
 */
export let activeAppid = 0;

export function setActiveAppid(appid: number): void {
  activeAppid = appid;
}

const RED = "#e05252";
const BG = "rgba(172, 178, 201, 0.14)";

/** A gamepad A press and a mouse click can both arrive: only open once. */
let lastOpenAt = 0;

const BUTTON: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 48,
  height: 48,
  borderRadius: 2,
  background: BG,
  padding: 4,
  boxSizing: "border-box",
  color: "#e6e8ea",
  flex: "0 0 auto",
};

const DOT: CSSProperties = {
  position: "absolute",
  right: 4,
  bottom: 4,
  width: 9,
  height: 9,
  borderRadius: 5,
  border: "1px solid rgba(0,0,0,0.55)",
  background: RED,
  boxShadow: `0 0 5px ${RED}`,
};

// Steam paints a focused icon white with a dark glyph; hover keeps the softer grey. Both live in
// CSS so the component never re-renders for a visual state.
const CSS = `[data-scskiller-button]:hover{background:rgba(205,213,226,0.26)!important}
[data-scskiller-button]:focus{background:#e6e8ea!important;color:#16191d!important}`;

function open(): void {
  const now = Date.now();
  if (now - lastOpenAt < 500) return;
  lastOpenAt = now;
  const appid = activeAppid;
  if (!appid) return;
  if (typeof showModal !== "function") {
    console.warn("[SCSKiller] Steam's showModal is unavailable; the QAM panel still works");
    return;
  }
  let handle: { Close: () => void } | null = null;
  handle = showModal(<ScskModal appid={appid} onClose={() => handle?.Close()} />, undefined, {
    strTitle: "SCSKiller",
    bHideMainWindowForPopouts: true,
  });
}

export function ScskButton() {
  return (
    <Focusable
      data-scskiller-button="1"
      style={BUTTON}
      onActivate={() => open()}
      onClick={() => open()}
      onOKActionDescription="SCSKiller"
      noFocusRing
    >
      <style>{CSS}</style>
      <ScskIcon size={24} />
      <span data-scskiller-dot="1" style={DOT} />
    </Focusable>
  );
}
