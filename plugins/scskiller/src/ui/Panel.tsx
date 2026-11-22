import { showModal } from "@decky/ui";
import { toaster } from "@decky/api";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelCompile,
  detect,
  extractAppImage,
  getCompiles,
  getLibrary,
  getSettings,
  openApp,
  setSettings,
  startCompile,
  type Detection,
  type LibraryGame,
  type Settings,
} from "../api";
import { diagnostics } from "../diagnostics";
import { useAppState } from "../hooks";
import { report } from "../report";
import { setJobs, setLibrary } from "../store";
import { COLORS, Dot } from "./atoms";
import { GamesTab } from "./GamesTab";
import { ScskModal } from "./ScskModal";
import { SetupTab } from "./SetupTab";
import { TabStrip, type TabDef } from "./TabStrip";
import { useWidePanel, WIDE_FROM } from "./wide";

let lastModalAt = 0;

function numericAppId(game: LibraryGame): number {
  if (game.appid) return game.appid;
  const digits = String(game.game_id).replace(/[^0-9]/g, "");
  const parsed = parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The Quick Access Menu panel: the
 * Games tab (SCSKiller's own table, widened to the whole QAM column) and a Setup tab.
 */
export function Panel() {
  const state = useAppState();
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useWidePanel(rootRef);
  const wide = width >= WIDE_FROM;

  const [tab, setTab] = useState("games");
  const [detection, setDetection] = useState<Detection | null>(null);
  const [settings, setLocalSettings] = useState<Settings | null>(null);
  const [path, setPath] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [injected, setInjected] = useState(diagnostics.injected);
  const [detail, setDetail] = useState(diagnostics.detail);

  const games = state.library?.games ?? [];
  const jobs = useMemo(() => {
    const list = Object.values(state.jobs);
    return list.sort((left, right) => {
      const runningDelta = Number(Boolean(right.running)) - Number(Boolean(left.running));
      if (runningDelta !== 0) return runningDelta;
      return (right.started_at ?? 0) - (left.started_at ?? 0);
    });
  }, [state.jobs]);
  const running = jobs.filter((job) => job.running).length;

  const workingRef = useRef(false);
  const initialTab = useRef(false);
  const previousRunning = useRef(0);

  useEffect(() => {
    workingRef.current = working;
  }, [working]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setInjected(diagnostics.injected);
      setDetail(diagnostics.detail);
    }, 1200);
    return () => window.clearInterval(timer);
  }, []);

  const refreshLibrary = async (rescan = false) => {
    const library = await getLibrary(rescan);
    setLibrary(library);
    return library;
  };

  const syncJobs = async () => {
    try {
      const result = await getCompiles();
      if (result?.ok) setJobs(result.jobs ?? []);
    } catch {
      // an older backend: the compile events still fill the list
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [detected, current] = await Promise.all([detect(), getSettings()]);
        if (cancelled) return;
        setDetection(detected);
        setLocalSettings(current);
        setPath(current.cli_path || detected.resolved.source || "");
        await refreshLibrary(false);
        await syncJobs();
      } catch (exc: unknown) {
        if (!cancelled) fail(String(exc));
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // one log line per panel opening: how wide the QAM gave us (visible in homebrew/logs)
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current || width === 0) return;
    reported.current = true;
    const qamView = rootRef.current?.ownerDocument?.defaultView;
    const screenWidth = Math.max(qamView?.screen?.availWidth ?? 0, qamView?.screen?.width ?? 0);
    const windowLeft = Math.round(qamView?.screenX ?? 0);
    report(
      `panel opened: ${Math.round(width)}px wide (wide=${width >= WIDE_FROM}, ` +
        `qam view=${Math.round(qamView?.innerWidth ?? 0)}px, screen=${screenWidth}px, window left=${windowLeft}px)`,
    );
  }, [width]);

  // SCSKiller rewrites games.json after every scan and compile: keep the table honest
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (workingRef.current) return;
      getLibrary(false)
        .then((library) => setLibrary(library))
        .catch(() => undefined);
    }, 20000);
    return () => window.clearInterval(timer);
  }, []);

  // a compile just ended: its numbers changed in games.json
  useEffect(() => {
    if (previousRunning.current > 0 && running === 0) {
      getLibrary(false)
        .then((library) => setLibrary(library))
        .catch(() => undefined);
    }
    previousRunning.current = running;
  }, [running]);

  // open on what is happening: compiles first when one is running
  useEffect(() => {
    if (initialTab.current) return;
    if (!state.library && jobs.length === 0) return;
    initialTab.current = true;
    if (running > 0) setTab("games");
  }, [state.library, jobs.length, running]);

  // errors are shown in the panel and written to the Decky log (the panel document is 1x1 px)
  const fail = (text: string) => {
    setMessage(text);
    report(`ui: ${text}`);
  };

  const run = async (label: string, action: () => Promise<void>) => {
    setWorking(true);
    setMessage(null);
    try {
      await action();
    } catch (exc: unknown) {
      fail(`${label}: ${String(exc)}`);
    } finally {
      setWorking(false);
    }
  };

  const copyDiagnostics = async () => {
    const text = JSON.stringify(
      { ...diagnostics, wide, panelWidth: width, page: window.location.href, userAgent: navigator.userAgent },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(text);
      toaster.toast({ title: "SCSKiller", body: "Game page diagnostics copied" });
    } catch {
      toaster.toast({ title: "SCSKiller", body: text.slice(0, 220) });
    }
  };

  const onDetect = () =>
    run("Detect", async () => {
      const detected = await detect();
      setDetection(detected);
      if (detected.resolved.ok) {
        setMessage(`Found SCSKiller ${detected.version || ""} (${detected.resolved.source})`);
      } else {
        fail(detected.resolved.error ?? "SCSKiller not found");
      }
    });

  const onExtract = () =>
    run("Extract", async () => {
      const result = await extractAppImage();
      setMessage(result?.ok ? `CLI ready at ${result.path}` : result?.error ?? "extraction failed");
      const current = await getSettings();
      setLocalSettings(current);
      setPath(current.cli_path);
      setDetection(await detect());
    });

  const onApplyPath = () =>
    run("Save path", async () => {
      const next = await setSettings({ cli_path: path.trim() });
      setLocalSettings(next);
      const detected = await detect();
      setDetection(detected);
      if (detected.resolved.ok) setMessage(`Using ${detected.resolved.source}`);
      else fail(detected.resolved.error ?? "not usable");
    });

  const onSave = (patch: Partial<Settings>) => {
    setSettings(patch)
      .then((next) => setLocalSettings(next))
      .catch((exc: unknown) => fail(String(exc)));
  };

  // one refresh action: it rescans SCSKiller's list and re-reads its numbers
  const onRefresh = () =>
    run("Refresh", async () => {
      const library = await refreshLibrary(true);
      await syncJobs();
      if (!library.ok) fail(library.error ?? "refresh failed");
    });

  const onCompile = (game: LibraryGame) =>
    run("Compile", async () => {
      const response = await startCompile(game.game_id, {});
      if (!response?.ok) fail(response?.error ?? "could not start the compile");
      await syncJobs();
    });

  const onStop = () => {
    cancelCompile().catch((exc: unknown) => fail(String(exc)));
  };

  const openDetails = (game: LibraryGame) => {
    const appid = numericAppId(game);
    if (!appid || typeof showModal !== "function") return;
    const now = Date.now();
    if (now - lastModalAt < 500) return;
    lastModalAt = now;
    let handle: { Close: () => void } | null = null;
    handle = showModal(<ScskModal appid={appid} onClose={() => handle?.Close()} />, undefined, {
      strTitle: "SCSKiller",
      bHideMainWindowForPopouts: true,
    });
  };

  const isLinux = (detection?.platform ?? "windows") === "linux";
  // the running compiles live on the full page now, not in a tab of this panel
  const tabs: TabDef[] = [
    { id: "games", label: "Games", badge: running },
    { id: "setup", label: "Setup" },
  ];

  return (
    <div
      ref={rootRef}
      data-scsk-root="1"
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: "0 12px 8px 6px",
      }}
    >
      <TabStrip tabs={tabs} active={tab} onSelect={setTab} autoFocus />

      {message ? (
        <div
          style={{
            margin: "0 2px 8px",
            padding: "5px 8px",
            borderRadius: 3,
            background: "rgba(245, 196, 66, 0.12)",
            color: COLORS.amber,
            fontSize: 11.5,
            lineHeight: 1.4,
            wordBreak: "break-word",
          }}
        >
          {message}
        </div>
      ) : null}

      {tab === "games" ? (
        <GamesTab
          wide={wide}
          library={state.library}
          games={games}
          jobs={state.jobs}
          working={working}
          onCompile={onCompile}
          onStop={onStop}
          onRefresh={onRefresh}
          onDetails={openDetails}
        />
      ) : (
        <SetupTab
          detection={detection}
          settings={settings}
          path={path}
          message={message}
          working={working}
          isLinux={isLinux}
          injected={injected}
          detail={detail}
          onPathChange={setPath}
          onDetect={onDetect}
          onExtract={onExtract}
          onOpenApp={() => openApp()}
          onApplyPath={onApplyPath}
          onSave={onSave}
          onCopyDiagnostics={copyDiagnostics}
        />
      )}
    </div>
  );
}
