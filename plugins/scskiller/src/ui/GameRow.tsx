import { Focusable } from "@decky/ui";
import { useState, type CSSProperties } from "react";
import type { CompileSnapshot, LibraryGame } from "../api";
import { formatBytes, formatCount, formatShortDuration, statusColor } from "../format";
import { COLORS, Dot, FOCUS_RING, MONO, SmallButton } from "./atoms";
import { GameLogo } from "./GameLogo";

/** Column widths, shared by the header and the rows so everything lines up. */
export const COLUMNS = {
  logo: 36,
  shaders: 64,
  pipelines: 64,
  cache: 62,
  time: 52,
  status: 150,
  action: 88,
};

const CELL: CSSProperties = {
  width: COLUMNS.shaders,
  flex: "0 0 auto",
  textAlign: "right",
  fontFamily: MONO,
  fontSize: 11.5,
  color: COLORS.text,
  opacity: 0.85,
  whiteSpace: "nowrap",
};

function cell(width: number): CSSProperties {
  return { ...CELL, width };
}

function subtitle(game: LibraryGame): string {
  // SCSKiller's engine string already carries the API ("REDengine 3 DX12"): only add the
  // API on its own when the engine is unknown.
  const engine = game.engine || game.stats?.engine || "";
  const cover = engine || game.api || game.stats?.api || "";
  const parts = [cover, game.store].filter((part): part is string => Boolean(part));
  return Array.from(new Set(parts)).join(" | ");
}

function shadersOf(game: LibraryGame): string {
  return formatCount(game.stats?.shaders ?? null);
}

function pipelinesOf(game: LibraryGame): string {
  return formatCount(game.stats?.pipelines ?? null);
}

function cacheOf(game: LibraryGame): string {
  return formatBytes(game.stats?.cache_bytes ?? game.cache_bytes) || "-";
}

function timeOf(game: LibraryGame): string {
  const short = formatShortDuration(game.last_compile_seconds ?? game.stats?.last_compile_seconds);
  // an estimate, not a measurement: always shown with the tilde
  return short ? `~${short}` : "";
}

/** Cache size and (estimated) last compile time: the only numbers the narrow row shows. */
function narrowStats(game: LibraryGame): string {
  const cache = formatBytes(game.stats?.cache_bytes ?? game.cache_bytes);
  return [cache, timeOf(game)].filter(Boolean).join(" \u00b7 ");
}

function detailOf(game: LibraryGame): string {
  const parts: string[] = [];
  if (game.reason) parts.push(game.reason);
  if (game.new_pipelines) parts.push(`${formatCount(game.new_pipelines)} new pipelines`);
  if (game.known_stutter) parts.push(`stutter: ${game.known_stutter}`);
  return parts.join(" - ");
}

export function GameTableHeader() {
  const label: CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: COLORS.faint,
    textAlign: "right",
    whiteSpace: "nowrap",
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 8px 4px",
        borderBottom: `1px solid ${COLORS.line}`,
      }}
    >
      <div style={{ width: COLUMNS.logo, flex: "0 0 auto" }} />
      <div style={{ flex: 1, minWidth: 0, ...label, textAlign: "left" }}>Game</div>
      <div style={{ ...label, width: COLUMNS.shaders }}>Shaders</div>
      <div style={{ ...label, width: COLUMNS.pipelines }}>Pipelines</div>
      <div style={{ ...label, width: COLUMNS.cache }}>Cache</div>
      <div style={{ ...label, width: COLUMNS.time }}>Time</div>
      <div style={{ ...label, width: COLUMNS.status }}>Status</div>
      <div style={{ width: COLUMNS.action, flex: "0 0 auto" }} />
    </div>
  );
}

function CompileButton({
  busy,
  blocked,
  disabled,
  onCompile,
  onStop,
  compact,
}: {
  busy: boolean;
  /** Unsupported game: the label says so instead of showing a live Compile button. */
  blocked: boolean;
  /** Warmed or waiting for a 5 min recording: nothing to compile, the button is greyed. */
  disabled: boolean;
  onCompile: () => void;
  onStop: () => void;
  compact?: boolean;
}) {
  const style = compact
    ? { width: 74, padding: "4px 8px", fontSize: 11 }
    : { width: COLUMNS.action };
  if (busy) {
    return (
      <SmallButton tone="danger" onClick={onStop} style={style}>
        Stop
      </SmallButton>
    );
  }
  return (
    <SmallButton tone="normal" disabled={disabled || blocked} onClick={onCompile} style={style}>
      {blocked ? "Blocked" : "Compile"}
    </SmallButton>
  );
}

/**
 * One row of the games table. Wide layout follows SCSKiller's own table (logo, full name,
 * shaders, pipelines, cache, time, status); below ~620px the same numbers fold into one
 * mono line under the name.
 */
export function GameRow({
  game,
  wide,
  job,
  onDetails,
  onCompile,
  onStop,
}: {
  game: LibraryGame;
  wide: boolean;
  job?: CompileSnapshot;
  onDetails: () => void;
  onCompile: () => void;
  onStop: () => void;
}) {
  const [active, setActive] = useState(false);
  // focus is tracked separately: React bubbles onFocus, so a shared flag would outline the
  // row even while the Compile button (a sibling) has the gamepad focus
  const [focused, setFocused] = useState(false);
  const running = Boolean(job?.running);
  const kind = game.status.kind;
  const blocked = kind === "blocked";
  // a warmed game has nothing to compile, and SCSKiller needs a 5 min recording first:
  // in both cases the row button is greyed out (the stats dialog explains why)
  const notCompilable = blocked || kind === "ok" || kind === "recording";
  const color = statusColor(game.status);
  const details = detailOf(game);

  const focus = {
    onMouseEnter: () => setActive(true),
    onMouseLeave: () => setActive(false),
  };

  if (!wide) {
    // Narrow panel. Two SIBLING focusables: the text block (A = stats) and the Compile
    // button. Nested focusables are not reachable by Steam's gamepad navigation, so the
    // button must not live inside the row's focusable element.
    return (
      <div
        onClick={onDetails}
        {...focus}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          boxSizing: "border-box",
          padding: "5px 4px",
          borderRadius: 3,
          background: active ? COLORS.hover : "transparent",
        }}
      >
        <GameLogo appid={game.appid} name={game.name} size={26} />
        <Focusable
          noFocusRing
          onActivate={onDetails}
          onClick={(event: any) => {
            event?.stopPropagation?.();
            onDetails();
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "2px 4px",
            borderRadius: 3,
            boxShadow: focused ? FOCUS_RING : "none",
          }}
        >
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              lineHeight: 1.2,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              wordBreak: "break-word",
            }}
          >
            {/* inline, so the dot always sits on the first line of the name */}
            <span style={{ display: "inline-block", verticalAlign: "1px", marginRight: 6 }}>
              <Dot color={color} size={7} />
            </span>
            {game.name}
          </div>
          {narrowStats(game) ? (
            <div
              style={{
                fontFamily: MONO,
                fontSize: 9.5,
                color: COLORS.faint,
                marginTop: 2,
                marginLeft: 12,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {narrowStats(game)}
            </div>
          ) : null}
        </Focusable>
        <CompileButton
          compact
          busy={running}
          blocked={blocked}
          disabled={notCompilable}
          onCompile={onCompile}
          onStop={onStop}
        />
      </div>
    );
  }

  return (
    <Focusable
      noFocusRing
      onActivate={onDetails}
      onClick={onDetails}
      {...focus}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        boxSizing: "border-box",
        padding: "5px 8px",
        borderRadius: 3,
        background: active ? COLORS.hover : "transparent",
      }}
    >
      <GameLogo appid={game.appid} name={game.name} size={COLUMNS.logo} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.25,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "break-word",
          }}
        >
          {game.name}
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: COLORS.faint,
            marginTop: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {subtitle(game) || game.game_id}
        </div>
      </div>
      <div style={cell(COLUMNS.shaders)}>{shadersOf(game)}</div>
      <div style={cell(COLUMNS.pipelines)}>{pipelinesOf(game)}</div>
      <div style={cell(COLUMNS.cache)}>{cacheOf(game)}</div>
      <div style={cell(COLUMNS.time)}>{timeOf(game)}</div>
      <div style={{ width: COLUMNS.status, flex: "0 0 auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Dot color={color} />
          <span style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {game.status.label}
          </span>
        </div>
        {details ? (
          <div
            style={{
              fontSize: 10.5,
              color: COLORS.faint,
              lineHeight: 1.3,
              marginTop: 1,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {details}
          </div>
        ) : null}
      </div>
      <CompileButton
        busy={running}
        blocked={blocked}
        disabled={notCompilable}
        onCompile={onCompile}
        onStop={onStop}
      />
    </Focusable>
  );
}
