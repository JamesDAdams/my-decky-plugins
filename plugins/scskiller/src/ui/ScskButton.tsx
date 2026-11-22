import { Focusable, showModal } from "@decky/ui";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getCompiles, getStatus } from "../api";
import { useAppState } from "../hooks";
import { setJobs, setStatus } from "../store";
import { KIND_COLORS } from "../format";
import { ScskIcon } from "./ScskIcon";
import { ScskModal } from "./ScskModal";

const RED = "#e05252";

// measured on Steam's own action icons: resting and hovered backgrounds
const BG = "rgba(172, 178, 201, 0.14)";
const BG_ACTIVE = "rgba(205, 213, 226, 0.26)";

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
  transition: "background-color 0.12s ease",
};

const DOT: CSSProperties = {
  position: "absolute",
  right: 4,
  bottom: 4,
  width: 9,
  height: 9,
  borderRadius: 5,
  border: "1px solid rgba(0,0,0,0.55)",
};

/** "steam:292030" -> "292030": the store keys statuses by the plain app id. */
function plainId(value: unknown): string {
  return String(value ?? "").replace(/^steam:/, "");
}

/**
 * The compact button that sits with Steam's own action icons (left of the controller
 * button). It always keeps the SCSKiller icon - the compile itself is driven from the
 * strip drawn over the Play button - and it carries SCSKiller's status as a coloured dot.
 */
export function ScskButton({ appid }: { appid: number }) {
  const state = useAppState();
  const status = state.statuses[String(appid)];
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const wasRunning = useRef(false);

  useEffect(() => {
    if (!appid) return;
    getStatus(appid)
      .then((result) => setStatus(appid, result))
      .catch(() => undefined);
  }, [appid]);

  // the game page must know about a running compile even if the QAM was never opened,
  // and the status dot has to catch up as soon as that compile ends
  useEffect(() => {
    if (!appid) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const result = await getCompiles();
        if (!alive) return;
        setJobs(result?.jobs ?? []);
        const job = (result?.jobs ?? []).find((item) => plainId(item.app_id) === String(appid));
        const running = Boolean(job?.running);
        if (wasRunning.current && !running) {
          // compile over: SCSKiller's own state changed, the dot must follow
          const fresh = await getStatus(appid, true);
          if (alive && fresh) setStatus(appid, fresh);
        }
        wasRunning.current = running;
      } catch {
        // the badge simply stays as it is
      }
    };
    tick();
    const timer = window.setInterval(tick, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [appid]);

  const color = status?.ok ? KIND_COLORS[String(status.status?.kind ?? "unknown")] ?? RED : RED;

  const open = () => {
    const now = Date.now();
    if (now - lastOpenAt < 500) return;
    lastOpenAt = now;
    if (typeof showModal !== "function") {
      console.warn("[SCSKiller] Steam's showModal is unavailable; the QAM panel still works");
      return;
    }
    let handle: { Close: () => void } | null = null;
    handle = showModal(<ScskModal appid={appid} onClose={() => handle?.Close()} />, undefined, {
      strTitle: "SCSKiller",
      bHideMainWindowForPopouts: true,
    });
  };

  return (
    <Focusable
      style={{
        ...BUTTON,
        // Steam paints the focused icon white and darkens the glyph; a controller user has to
        // see the same thing on this button, hover is the softer grey only.
        background: focused ? "#e6e8ea" : hovered ? BG_ACTIVE : BG,
        color: focused ? "#16191d" : "#e6e8ea",
      }}
      onActivate={() => open()}
      onClick={() => open()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onOKActionDescription="SCSKiller"
      noFocusRing
    >
      <ScskIcon size={24} />
      <span style={{ ...DOT, background: color, boxShadow: `0 0 5px ${color}` }} />
    </Focusable>
  );
}
