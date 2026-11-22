import { executeInTab } from "@decky/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { cancelCompile, cancelQueued, clearFinished, getCompiles, getLibrary, pauseCompile, resumeCompile, startQueued, type CompileSnapshot, type LibraryGame } from "../api";
import { formatDuration } from "../format";

/**
 * Full-page SCSKiller view, built with the metrics of Steam's own Downloads page (measured
 * there): 24px page padding, 30px title, 20px/400 section titles with a hairline rule to the
 * right, 16px body text rgb(220,222,223), capsule + progress bar rows.
 */

const PAGE_X = 24;
const TEXT = "rgb(220, 222, 223)";
const HAIRLINE = "rgba(220, 222, 223, 0.16)";

function capsuleUrl(appid?: number | null): string | undefined {
  if (!appid) return undefined;
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;
}

/** "Warming 1274/21449" -> 0.06 ; -1 when the line has no numbers. */
function progressOf(job?: CompileSnapshot | null): number {
  if (!job) return -1;
  const lines = job.lines ?? [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = String(lines[i]?.text ?? "");
    const match = text.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
    if (match) {
      const done = Number(match[1].replace(/,/g, ""));
      const total = Number(match[2].replace(/,/g, ""));
      if (total > 0) return Math.max(0, Math.min(1, done / total));
    }
  }
  return -1;
}

function Bar({ value }: { value: number }) {
  const width = value < 0 ? 25 : Math.round(value * 100);
  return (
    <div style={{ height: 4, borderRadius: 2, background: "rgba(220,222,223,0.18)", overflow: "hidden", maxWidth: 620 }}>
      <div
        style={{
          width: `${width}%`,
          height: "100%",
          background: value < 0 ? "rgba(26,159,255,0.7)" : "#1a9fff",
          transition: "width 0.4s ease",
        }}
      />
    </div>
  );
}

function Section({ title, count, caption, action }: { title: string; count: number; caption?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "26px 0 10px" }}>
      <span style={{ fontSize: 20, fontWeight: 400, whiteSpace: "nowrap" }}>{title}</span>
      <span style={{ fontSize: 16, color: "rgba(220,222,223,0.65)", whiteSpace: "nowrap" }}>({count})</span>
      <div style={{ flex: 1, height: 1, background: HAIRLINE, marginLeft: 6 }} />
      {action}
      {caption ? (
        <span style={{ fontSize: 11, letterSpacing: "0.08em", color: "rgba(220,222,223,0.65)", whiteSpace: "nowrap" }}>
          {caption}
        </span>
      ) : null}
    </div>
  );
}

/** Steam's secondary button (same box as "Clear All" on the downloads page). */
function PageButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        minWidth: 150,
        padding: "11px 20px",
        borderRadius: 2,
        border: "none",
        background: "rgba(255,255,255,0.16)",
        color: "#fff",
        fontSize: 16,
        fontWeight: 500,
        cursor: "pointer",
        flex: "0 0 auto",
      }}
    >
      {label}
    </button>
  );
}

export function CompilesPage() {
  const [jobs, setJobs] = useState<CompileSnapshot[]>([]);
  const [queue, setQueue] = useState<{ app_id: string; position: number }[]>([]);
  const [games, setGames] = useState<Record<string, LibraryGame>>({});
  const [error, setError] = useState<string | null>(null);
  const anchor = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    // Steam hands the focus to its own search field when a route has nothing focusable, and
    // that field then shows up white and selected on top of the page. Give the page its own
    // focus anchor (below) and push the search field out for the first seconds of the mount.
    try {
      anchor.current?.focus({ preventScroll: true });
    } catch {
      // older focus(): no options object
      anchor.current?.focus?.();
    }
    const pushOut = () => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return;
      const tag = active.tagName;
      const isField = tag === "INPUT" || tag === "TEXTAREA" || active.getAttribute("role") === "searchbox";
      if (isField) active.blur();
    };
    pushOut();
    // the visible page lives in the Big Picture window, not in this (1x1 px) document: the
    // blur has to happen there. Steam focuses that field *after* the route renders, so keep
    // pushing it out for a while; the first user interaction stops the watchdog
    const visibleBlur =
      "(() => {" +
      "const active = document.activeElement;" +
      "if (!active) return 'none';" +
      "const tag = active.tagName;" +
      "const field = tag === 'INPUT' || tag === 'TEXTAREA' || active.getAttribute('role') === 'searchbox';" +
      "if (!field) return tag;" +
      "active.blur();" +
      "return 'blurred';" +
      "})()";
    let touched = false;
    const onTouched = () => {
      touched = true;
    };
    window.addEventListener("pointerdown", onTouched, true);
    window.addEventListener("keydown", onTouched, true);
    const watch = window.setInterval(() => {
      if (touched) return;
      pushOut();
      void executeInTab("Steam Big Picture Mode", false, visibleBlur).catch(() => undefined);
    }, 200);
    const stop = window.setTimeout(() => window.clearInterval(watch), 12000);
    const tick = async () => {
      try {
        const [compiles, library] = await Promise.all([getCompiles(), getLibrary(false)]);
        if (!alive) return;
        setJobs(compiles?.jobs ?? []);
        setQueue(compiles?.queue ?? []);
        const map: Record<string, LibraryGame> = {};
        for (const game of library?.games ?? []) map[game.game_id] = game;
        setGames(map);
        setError(compiles?.ok === false ? compiles.error ?? "could not read the compiles" : null);
      } catch (exc) {
        if (alive) setError(String(exc));
      }
    };
    tick();
    const timer = window.setInterval(tick, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.clearInterval(watch);
      window.clearTimeout(stop);
      window.removeEventListener("pointerdown", onTouched, true);
      window.removeEventListener("keydown", onTouched, true);
    };
  }, []);

  const running = useMemo(() => jobs.filter((job) => job.running), [jobs]);
  const finished = useMemo(
    () =>
      jobs
        .filter((job) => !job.running)
        .sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0))
        .slice(0, 12),
    [jobs],
  );

  const nameOf = (appId: string) => games[appId]?.name ?? appId.replace(/^steam:/, "");

  const row = (
    key: string,
    appId: string,
    title: string,
    detail: string,
    value: number,
    actions?: { label: string; onClick: () => void; disabled?: boolean }[],
    right?: string,
  ) => (
    <div key={key} style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 0", borderBottom: `1px solid ${HAIRLINE}` }}>
      <div style={{ width: 92, height: 43, flex: "0 0 auto", borderRadius: 2, overflow: "hidden", background: "rgba(220,222,223,0.08)" }}>
        {capsuleUrl(Number(String(appId).replace(/^steam:/, ""))) ? (
          <img src={capsuleUrl(Number(String(appId).replace(/^steam:/, "")))} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : null}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <div style={{ fontSize: 14, color: "rgba(220,222,223,0.72)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {detail}
        </div>
        {value >= -1 ? (
          <div style={{ marginTop: 8 }}>
            <Bar value={value} />
          </div>
        ) : null}
      </div>
      {right ? (
        <div style={{ fontSize: 12, letterSpacing: "0.08em", color: "rgba(220,222,223,0.72)", whiteSpace: "nowrap", flex: "0 0 auto" }}>
          {right}
        </div>
      ) : null}
      {(actions ?? []).map((action) => (
        <button
          key={action.label}
          onClick={action.onClick}
          disabled={action.disabled}
          style={{
            minWidth: 96,
            padding: "11px 18px",
            borderRadius: 2,
            border: "none",
            background: action.disabled ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.16)",
            color: action.disabled ? "rgba(255,255,255,0.4)" : "#fff",
            fontSize: 16,
            fontWeight: 500,
            cursor: action.disabled ? "default" : "pointer",
            flex: "0 0 auto",
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );

  return (
    <div
      ref={anchor}
      tabIndex={0}
      style={{
        padding: `40px ${PAGE_X}px 60px`,
        color: "#fff",
        minHeight: "100vh",
        boxSizing: "border-box",
        outline: "none",
      }}
    >
      {/* focus anchor: keeps Steam from selecting its search field when the page opens */}
      <div style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.2 }}>SCSKiller</div>
      <div style={{ fontSize: 16, color: TEXT, marginTop: 6 }}>
        {running.length > 0
          ? `${running.length} compiling - ${queue.length} in the queue`
          : queue.length > 0
            ? `${queue.length} in the queue`
            : "Nothing compiling"}
      </div>

      {error ? <div style={{ marginTop: 14, fontSize: 16, color: "#f5c442" }}>{error}</div> : null}

      <Section title="In progress" count={running.length} caption="COMPILE STARTS WITH THE GAME CLOSED" />
      {running.length === 0 ? (
        <div style={{ fontSize: 16, color: TEXT, padding: "5px 0 0" }}>No compile is running</div>
      ) : (
        running.map((job) => {
          const last = job.lines?.[job.lines.length - 1];
          const stage = job.stage || String(last?.text ?? "") || "starting";
          const elapsed = job.started_at ? Date.now() / 1000 - job.started_at : 0;
          return row(
            `run-${job.app_id}`,
            job.app_id,
            nameOf(job.app_id),
            `${stage} - ${formatDuration(Math.round(elapsed)) || "starting"}${job.paused ? " - paused" : ""}`,
            job.paused ? -3 : progressOf(job),
            [
              {
                label: job.paused ? "Resume" : "Pause",
                onClick: () => void (job.paused ? resumeCompile() : pauseCompile()),
              },
              { label: "Stop", onClick: () => void cancelCompile() },
            ],
          );
        })
      )}

      <Section title="Queue" count={queue.length} />
      {queue.length === 0 ? (
        <div style={{ fontSize: 16, color: TEXT, padding: "5px 0 0" }}>The queue is empty</div>
      ) : (
        queue.map((item) =>
          row(
            `queue-${item.app_id}`,
            item.app_id,
            nameOf(item.app_id),
            running.length > 0
              ? `position ${item.position} - starts when the current compile ends`
              : `position ${item.position} - press Start to compile it now`,
            -2,
            [
              { label: "Start", onClick: () => void startQueued(item.app_id), disabled: running.length > 0 },
              { label: "Remove", onClick: () => void cancelQueued(item.app_id) },
            ],
          ),
        )
      )}

      <Section
        title="Finished"
        count={finished.length}
        action={finished.length > 0 ? <PageButton label="Clear All" onClick={() => void clearFinished()} /> : undefined}
      />
      {finished.length === 0 ? (
        <div style={{ fontSize: 16, color: TEXT, padding: "5px 0 0" }}>No compile finished in this session</div>
      ) : (
        finished.map((job) => {
          const done = job.finished_at ?? job.started_at;
          const when = done
            ? new Date(done * 1000).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
            : "";
          return row(
            `done-${job.app_id}-${job.started_at}`,
            job.app_id,
            nameOf(job.app_id),
            job.ok ? "compiled" : job.error ?? "failed",
            -2,
            undefined,
            when ? `COMPLETED: ${when.toUpperCase()}` : undefined,
          );
        })
      )}
    </div>
  );
}
