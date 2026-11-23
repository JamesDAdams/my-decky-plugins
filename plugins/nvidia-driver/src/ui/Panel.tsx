import { ButtonItem, PanelSection, PanelSectionRow } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { cancelInstall, getState, install, openNvidiaApp, report, type DriverState } from "../api";
import { pushTopBar, setTopBarState } from "../topBar";

function sizeText(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function speedText(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return "";
  const mb = bytesPerSecond / (1024 * 1024);
  return `${mb.toFixed(1)} MB/s`;
}

function dateText(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const MUTED = "#8f98a0";
const TEXT = "#dcdedf";
const GREEN = "#76b900";
const RED = "#ff8a80";

/** The Decky panel: what the NVIDIA App reports, and the one button that installs it. */
export function Panel() {
  const [state, setState] = useState<DriverState | null>(null);
  const [error, setError] = useState("");
  const mounted = useRef(true);

  const apply = (next: DriverState) => {
    if (!mounted.current) return;
    setState(next);
    setTopBarState({ update: Boolean(next.update), version: next.latest || "" });
    pushTopBar();
  };

  const refresh = async (force: boolean) => {
    try {
      const next = await getState(force);
      apply(next);
      setError("");
    } catch (exc) {
      if (mounted.current) setError(String(exc));
    }
  };

  useEffect(() => {
    mounted.current = true;
    refresh(true);
    return () => {
      mounted.current = false;
    };
  }, []);

  const installation = state?.install;
  const phase = installation?.phase ?? "idle";
  const running = phase === "downloading" || phase === "starting" || phase === "installing";
  const finished = phase === "done" || phase === "error" || phase === "timeout" || phase === "cancelled";

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      refresh(false);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (finished) refresh(true);
  }, [phase]);

  const startInstall = async () => {
    setError("");
    try {
      const reply = await install();
      if (!reply?.ok) {
        setError(reply?.error || "the install did not start");
        report(`install refused: ${reply?.error || "unknown"}`);
      } else {
        report(`install started: ${reply.version}`);
      }
      await refresh(false);
    } catch (exc) {
      setError(String(exc));
    }
  };

  const stopDownload = async () => {
    try {
      await cancelInstall();
      await refresh(false);
    } catch (exc) {
      setError(String(exc));
    }
  };

  const openApp = async () => {
    try {
      const reply = await openNvidiaApp();
      if (!reply?.ok) setError(reply?.error || "could not start the NVIDIA App");
    } catch (exc) {
      setError(String(exc));
    }
  };

  const installed = state?.installed || "";
  const latest = state?.latest || "";
  const update = Boolean(state?.update);
  const sourceLabel =
    state?.source === "nvidia-app"
      ? "reported by the NVIDIA App"
      : state?.source === "nvidia-app-log"
        ? "from the NVIDIA App's last check"
        : "NVIDIA App not reachable";

  let progress = "";
  if (installation && running) {
    if (phase === "downloading") {
      const parts = [`${Math.round(installation.percent || 0)}%`];
      if (installation.total) parts.push(sizeText(installation.bytes) + " / " + sizeText(installation.total));
      const speed = speedText(installation.speed || 0);
      if (speed) parts.push(speed);
      progress = "Downloading - " + parts.join(" - ");
    } else if (phase === "starting") {
      progress = "Starting NVIDIA's installer...";
    } else {
      progress = "Installing - the screen may go black for a minute";
    }
  }

  return (
    <PanelSection title="NVIDIA driver">
      <PanelSectionRow>
        <div style={{ color: MUTED, fontSize: "12px", lineHeight: "16px" }}>
          {state?.gpu || "NVIDIA GPU"}
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <div style={{ color: TEXT, fontSize: "14px", lineHeight: "20px" }}>
          {installed ? `Installed ${installed}` : "Installed driver unknown"}
          {latest && latest !== installed ? (
            <span style={{ color: GREEN }}>
              {" "}
              | {latest} available{state?.release_date ? ` (${dateText(state.release_date)})` : ""}
            </span>
          ) : null}
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <div style={{ color: MUTED, fontSize: "11px", lineHeight: "15px" }}>{sourceLabel}</div>
      </PanelSectionRow>

      {progress ? (
        <PanelSectionRow>
          <div style={{ color: TEXT, fontSize: "13px", lineHeight: "18px" }}>{progress}</div>
        </PanelSectionRow>
      ) : null}
      {finished && installation?.message ? (
        <PanelSectionRow>
          <div style={{ color: installation.phase === "done" ? GREEN : TEXT, fontSize: "13px", lineHeight: "18px" }}>
            {installation.message}
          </div>
        </PanelSectionRow>
      ) : null}
      {installation?.phase === "error" && installation.error ? (
        <PanelSectionRow>
          <div style={{ color: RED, fontSize: "12px", lineHeight: "16px" }}>{installation.error}</div>
        </PanelSectionRow>
      ) : null}
      {error ? (
        <PanelSectionRow>
          <div style={{ color: RED, fontSize: "12px", lineHeight: "16px" }}>{error}</div>
        </PanelSectionRow>
      ) : null}
      {state?.error && state.source === "none" ? (
        <PanelSectionRow>
          <div style={{ color: RED, fontSize: "12px", lineHeight: "16px" }}>{state.error}</div>
        </PanelSectionRow>
      ) : null}

      {update && !running ? (
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={startInstall}>
            {`Install ${latest}`}
          </ButtonItem>
        </PanelSectionRow>
      ) : null}
      {phase === "downloading" ? (
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={stopDownload}>
            Cancel download
          </ButtonItem>
        </PanelSectionRow>
      ) : null}
      {!running ? (
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => refresh(true)}>
            Check again
          </ButtonItem>
        </PanelSectionRow>
      ) : null}
      {!running ? (
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={openApp}>
            Open NVIDIA App
          </ButtonItem>
        </PanelSectionRow>
      ) : null}
      <PanelSectionRow>
        <div style={{ color: MUTED, fontSize: "11px", lineHeight: "15px" }}>
          {running
            ? "Keep Steam open. Windows may ask for permission to install the driver."
            : "Installs NVIDIA's own package for this driver; Windows asks for permission."}
        </div>
      </PanelSectionRow>
    </PanelSection>
  );
}
