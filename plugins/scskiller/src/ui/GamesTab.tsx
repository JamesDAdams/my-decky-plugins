import type { CompileSnapshot, LibraryGame, LibraryResult } from "../api";
import { KIND_COLORS } from "../format";
import { COLORS, Dot, Hint, MONO, SmallButton } from "./atoms";
import { GameRow, GameTableHeader } from "./GameRow";

const NEEDS = new Set(["stale", "todo", "partial", "recording"]);

/** The row only carries the coloured dot now: this is the key for it. */
const LEGEND: Array<{ kind: string; label: string }> = [
  { kind: "ok", label: "Warmed" },
  { kind: "stale", label: "Needs rebuild" },
  { kind: "todo", label: "Not compiled" },
  { kind: "partial", label: "Partial" },
  { kind: "recording", label: "Needs 5m recording" },
  { kind: "blocked", label: "Blocked" },
];

function StatusLegend() {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "2px 9px",
        margin: "1px 1px 0",
        fontSize: 9.5,
        color: COLORS.faint,
      }}
    >
      {LEGEND.map((item) => (
        <span key={item.kind} style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
          <Dot color={KIND_COLORS[item.kind]} size={6} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function GamesTab({
  wide,
  library,
  games,
  jobs,
  working,
  onCompile,
  onStop,
  onRefresh,
  onDetails,
}: {
  wide: boolean;
  library?: LibraryResult;
  games: LibraryGame[];
  jobs: Record<string, CompileSnapshot>;
  working: boolean;
  onCompile: (game: LibraryGame) => void;
  onStop: () => void;
  onRefresh: () => void;
  onDetails: (game: LibraryGame) => void;
}) {
  const needs = games.filter((game) => NEEDS.has(game.status.kind)).length;

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, margin: "2px 2px 8px" }}>
        <div style={{ fontSize: 12, color: COLORS.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {games.length === 0 ? "No games yet" : `${games.length} games`}
          {needs > 0 ? ` - ${needs} to compile` : ""}
          {wide && library?.driver ? <span style={{ opacity: 0.7 }}>{` - driver ${library.driver}`}</span> : null}
        </div>
        <SmallButton onClick={onRefresh} disabled={working} style={{ width: "100%" }}>
          {working ? "Working..." : "Refresh"}
        </SmallButton>
        <StatusLegend />
      </div>

      {library && !library.ok && library.error ? (
        <div style={{ margin: "6px 2px", fontSize: 12, color: COLORS.amber }}>{library.error}</div>
      ) : null}

      {games.length === 0 ? (
        <Hint>
          No list yet. SCSKiller writes it when it scans; press Rescan (it runs `scskiller status`, which takes a
          few seconds).
        </Hint>
      ) : (
        <>
          {wide ? <GameTableHeader /> : null}
          {games.map((game) => (
            <GameRow
              key={game.game_id}
              game={game}
              wide={wide}
              job={jobs[game.game_id]}
              onDetails={() => onDetails(game)}
              onCompile={() => onCompile(game)}
              onStop={onStop}
            />
          ))}
          {wide ? (
            <div style={{ marginTop: 6, fontSize: 10.5, color: COLORS.faint, fontFamily: MONO }}>
              A = details | Compile starts SCSKiller with the game closed
            </div>
          ) : (
            // the QAM navigates one row per press: up/down = games, right = that row's button
            <div style={{ marginTop: 8, fontSize: 9.5, color: COLORS.faint, fontFamily: MONO, lineHeight: 1.5 }}>
              A = stats on a row - right = its Compile button
            </div>
          )}
        </>
      )}
    </div>
  );
}
