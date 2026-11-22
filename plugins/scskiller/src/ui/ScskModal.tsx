import { Focusable, ModalRoot } from "@decky/ui";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { cancelCompile, getStatus, startCompile, type GameStatus } from "../api";
import { formatBytes, formatDuration, KIND_COLORS } from "../format";
import { useAppState } from "../hooks";
import { setStatus } from "../store";
import { ScskIcon } from "./ScskIcon";

const GREEN = "#59bf40";
const RED = "#e05252";
const AMBER = "#f5c442";

/** Steam's modal chrome, with a plain container fallback if the lookup ever misses. */
const ModalShell: any =
  ModalRoot ||
  ((props: { children?: ReactNode }) => <div style={{ padding: 16 }}>{props.children}</div>);

const LABEL: CSSProperties = { width: 132, flex: "0 0 auto", opacity: 0.6, fontSize: 13 };
const VALUE: CSSProperties = { flex: 1, minWidth: 0, fontSize: 13, wordBreak: "break-word" };
const ROW: CSSProperties = { display: "flex", gap: 12, padding: "3px 0", alignItems: "baseline" };
const BUTTON: CSSProperties = {
  padding: "7px 16px",
  borderRadius: 4,
  fontSize: 13,
  fontWeight: 600,
  background: "rgba(255,255,255,0.12)",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={ROW}>
      <div style={LABEL}>{label}</div>
      <div style={VALUE}>{children}</div>
    </div>
  );
}

function number(value?: number | null): string {
  return value === undefined || value === null ? "-" : value.toLocaleString();
}

function statusColor(status?: GameStatus): string {
  if (!status?.ok) return RED;
  return KIND_COLORS[String(status.status?.kind ?? "unknown")] ?? RED;
}

/**
 * The stats dialog: what SCSKiller's own game page and library columns show
 * (shaders, pipelines, cache, time, status), plus the compile controls.
 */
export function ScskModal({ appid, onClose }: { appid: number; onClose: () => void }) {
  const state = useAppState();
  const status = state.statuses[String(appid)];
  const job = state.jobs[String(appid)];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appid) return;
    getStatus(appid)
      .then((result) => {
        setStatus(appid, result);
        if (!result?.ok) setError(result?.error ?? "SCSKiller did not answer");
      })
      .catch((exc: unknown) => setError(String(exc)));
  }, [appid]);

  const stats = status?.stats ?? {};
  const running = Boolean(job?.running);
  const kind = status?.status?.kind;
  // same rule as the row: warmed or waiting for a 5 min recording = nothing to compile
  const warmed = kind === "ok";
  const blocked = !status?.ok || kind === "blocked" || kind === "recording" || warmed;
  const color = statusColor(status);

  const compile = async () => {
    if (busy || running || blocked) return;
    setBusy(true);
    setError(null);
    try {
      const response = await startCompile(appid, {});
      if (!response?.ok) {
        setError(response?.error ?? "could not start the compile");
        return;
      }
      // the compile runs on its own page: get out of the way
      onClose();
    } catch (exc: unknown) {
      setError(String(exc));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const fresh = await getStatus(appid, true);
      setStatus(appid, fresh);
      if (!fresh?.ok) setError(fresh?.error ?? "SCSKiller did not answer");
    } catch (exc: unknown) {
      setError(String(exc));
    } finally {
      setBusy(false);
    }
  };

  const pipelines =
    stats.pipelines !== undefined && stats.pipelines !== null ? (
      <>
        {number(stats.pipelines)}
        <span style={{ opacity: 0.55 }}>
          {" "}
          ({number(stats.recorded)} recorded{stats.middleware ? `, ${number(stats.middleware)} middleware` : ""}
          {stats.d3d11_shaders ? `, ${number(stats.d3d11_shaders)} DX11` : ""})
        </span>
      </>
    ) : (
      "-"
    );

  const warm =
    stats.warmed_at || status?.warmed_at ? (
      <>
        {stats.warmed_at ?? status?.warmed_at}
        {stats.last_compile_seconds ? ` - ${formatDuration(stats.last_compile_seconds)}` : ""}
        {stats.driver ? <span style={{ opacity: 0.55 }}> - driver {stats.driver}</span> : null}
      </>
    ) : (
      "never"
    );

  return (
    <ModalShell onCancel={onClose} bDisableBackgroundDismiss={false}>
      <div style={{ minWidth: 520, maxWidth: 640, padding: "4px 2px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <span style={{ color, display: "flex" }}>
            <ScskIcon size={28} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {status?.name || status?.game_id || String(appid)}
            </div>
            <div style={{ fontSize: 13, opacity: 0.75 }}>
              <span style={{ color }}>*</span> {status?.status?.label ?? "..."}
              {status?.fields?.status_reason ? ` - ${status.fields.status_reason}` : ""}
            </div>
          </div>
        </div>

        <Row label="Shaders">{number(stats.shaders ?? status?.shader_count)}</Row>
        <Row label="Pipelines">{pipelines}</Row>
        <Row label="Cache">
          {formatBytes(stats.cache_bytes ?? status?.cache_bytes) || "-"}
          {stats.cache_in_use_bytes
            ? ` on disk, ${formatBytes(stats.cache_in_use_bytes)} in use`
            : " on disk"}
        </Row>
        <Row label="Estimated">
          {formatBytes(stats.estimate_bytes ?? status?.estimate_bytes) || "-"}
          {stats.estimate_seconds ? ` - ~${formatDuration(stats.estimate_seconds)}` : ""}
        </Row>
        <Row label="Last compile">{warm}</Row>
        <Row label="Coverage">
          {stats.coverage_pct ?? status?.covered_pct ?? "-"}
          {stats.coverage_pct !== undefined || status?.covered_pct !== undefined ? "%" : ""}
          {stats.api ? ` of ${stats.api}` : ""}
        </Row>
        <Row label="Engine">{stats.engine || status?.fields?.engine || "-"}</Row>
        <Row label="Recorder">
          {stats.recorder ?? status?.recorder_installed ? "installed" : "not installed"}
        </Row>
        {stats.new_pipelines ? (
          <Row label="Pending">{number(stats.new_pipelines)} new pipelines since the last compile</Row>
        ) : null}
        {stats.failed || stats.skipped ? (
          <Row label="Last warm">
            {number(stats.failed)} failed, {number(stats.skipped)} skipped
          </Row>
        ) : null}
        {stats.stutter || stats.stutter_reason ? (
          <Row label="Stutter">
            <span style={{ color: stats.stutter === "High" ? AMBER : undefined }}>
              {stats.stutter ?? "known"}
            </span>
            {stats.stutter_reason ? <span style={{ opacity: 0.7 }}> - {stats.stutter_reason}</span> : null}
          </Row>
        ) : null}

        {running ? (
          <div
            style={{
              marginTop: 8,
              padding: "8px 10px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.06)",
              fontFamily: "monospace",
              fontSize: 11,
              maxHeight: 90,
              overflow: "hidden",
            }}
          >
            <div style={{ marginBottom: 4, opacity: 0.8 }}>{job?.stage || "starting..."}</div>
            {(job?.lines ?? [])
              .slice(-3)
              .map((line) => line.text)
              .join("\n")}
          </div>
        ) : null}

        {error ? <div style={{ marginTop: 8, color: RED, fontSize: 12 }}>{error}</div> : null}

        {/* The footer must be a focus group of its own: inside the dialog's own node the three
            buttons are children of a *vertical* container, so the D-pad only moved up and down
            between them (measured: parent layout 1, left/right did nothing). A horizontal Focusable
            gives them a row: left/right walks the buttons, up/down leaves the group. */}
        <Focusable
          noFocusRing
          style={{ display: "flex", flexDirection: "row", gap: 8, justifyContent: "flex-end", alignItems: "center", marginTop: 14 }}
        >
          {busy ? <span style={{ fontSize: 12, opacity: 0.7 }}>working...</span> : null}
          <Focusable noFocusRing onActivate={refresh} style={{ ...BUTTON, opacity: busy ? 0.6 : 1 }}>
            <span>Refresh</span>
          </Focusable>
          {running ? (
            <Focusable
              noFocusRing
              onActivate={() => cancelCompile()}
              style={{ ...BUTTON, background: "rgba(224,82,82,0.85)" }}
            >
              <span>Stop</span>
            </Focusable>
          ) : (
            <Focusable
              noFocusRing
              onActivate={compile}
              style={{ ...BUTTON, background: blocked ? "rgba(255,255,255,0.12)" : "#1a9fff" }}
            >
              <span>{blocked ? (warmed ? "Warmed" : "Not compilable") : "Compile"}</span>
            </Focusable>
          )}
          <Focusable noFocusRing onActivate={onClose} style={BUTTON}>
            <span>Close</span>
          </Focusable>
        </Focusable>
      </div>
    </ModalShell>
  );
}
