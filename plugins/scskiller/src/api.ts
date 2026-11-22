import { callable } from "@decky/api";

/** Coarse status family, mirrored from main.py's STATUS_KINDS. */
export type StatusKind = "ok" | "todo" | "stale" | "partial" | "recording" | "blocked" | "unknown";

export interface StatusInfo {
  name: string;
  kind: StatusKind;
  label: string;
}

/** The numbers SCSKiller itself shows: shaders, pipelines, cache, time, coverage. */
export interface StatusStats {
  shaders?: number | null;
  pipelines?: number | null;
  recorded?: number | null;
  generated?: number | null;
  d3d11_shaders?: number | null;
  middleware?: number | null;
  root_signatures?: number | null;
  stage_sets?: number | null;
  cache_bytes?: number | null;
  cache_in_use_bytes?: number | null;
  estimate_bytes?: number | null;
  estimate_seconds?: number | null;
  last_compile_seconds?: number | null;
  warmed_at?: string | null;
  driver?: string | null;
  api?: string | null;
  engine?: string | null;
  recorder?: boolean | null;
  new_pipelines?: number | null;
  failed?: number | null;
  skipped?: number | null;
  stutter?: string | null;
  stutter_reason?: string | null;
  coverage_pct?: number | null;
}

/** One game, as `scskiller status <id>` described it. */
export interface GameStatus {
  ok: boolean;
  game_id: string;
  error?: string;
  name?: string;
  store?: string;
  status?: StatusInfo;
  fields?: Record<string, string>;
  stats?: StatusStats;
  warmed_at?: string | null;
  warmed_driver?: string;
  warmed_seconds?: number | null;
  cache_bytes?: number | null;
  cache_in_use_bytes?: number | null;
  covered_pct?: number | null;
  covered_api?: string;
  estimate_bytes?: number | null;
  estimate_seconds?: number | null;
  shader_count?: number | null;
  recorded_pipelines?: number | null;
  recorder_installed?: boolean;
  seconds?: number;
  source?: "cli" | "games.json";
  cached?: boolean;
  raw?: string;
}

/** A row of SCSKiller's own library list. */
export interface LibraryGame {
  game_id: string;
  /** Steam app id, when the game id is a Steam one ("steam:292030" -> 292030). */
  appid?: number | null;
  name: string;
  store?: string;
  status: StatusInfo;
  reason: string;
  cache_bytes?: number | null;
  recorder?: boolean;
  known_stutter?: string;
  /** The same numbers SCSKiller's own table shows for the row. */
  stats?: StatusStats;
  warmed_at?: string | null;
  last_compile_seconds?: number | null;
  estimate_seconds?: number | null;
  driver?: string | null;
  engine?: string | null;
  api?: string | null;
  new_pipelines?: number | null;
}

/** The plugin's compile jobs (running first), from `get_compiles`. */
export interface CompilesResult {
  ok: boolean;
  running: number;
  jobs: CompileSnapshot[];
  /** Compiles waiting for the running one: [{app_id, position}] */
  queue?: { app_id: string; position: number }[];
  error?: string;
}

export interface LibraryResult {
  ok: boolean;
  error?: string;
  games: LibraryGame[];
  build?: string;
  driver?: string;
  source: "games.json" | "cli" | "none";
  stale?: boolean;
}

export interface LineInfo {
  text: string;
  time?: string;
  game_id?: string;
  stage?: string | null;
  error?: string | null;
}

export interface CompileSnapshot {
  app_id: string;
  running: boolean;
  /** The CLI process is frozen (pause button): progress stops until resumed. */
  paused?: boolean;
  stage?: string;
  started_at?: number;
  /** Set by the frontend when the done event arrives (the backend snapshot has no clock). */
  finished_at?: number;
  exit_code?: number | null;
  ok?: boolean | null;
  error?: string | null;
  lines: LineInfo[];
}

export interface Detection {
  platform: "windows" | "wsl" | "linux";
  resolved: {
    mode: "path" | "exe" | "appimage" | "none" | string;
    argv: string[];
    source: string;
    ok: boolean;
    error?: string;
  };
  home: string;
  runs_as: number;
  data_dir: string;
  data_dirs?: string[];
  data_dir_ok?: boolean;
  gui?: string;
  appimages: string[];
  version?: string;
  version_ok?: boolean;
}

export interface Settings {
  cli_path: string;
  threads: number;
  idle: boolean;
  auto_refresh: number;
  extract_and_run: boolean;
}

export const getStatus = callable<[appid: number | string, refresh?: boolean], GameStatus>("get_status");
export const getLibrary = callable<[refresh?: boolean], LibraryResult>("get_library");
export const startCompile = callable<[appid: number | string, options?: Record<string, unknown>], any>(
  "start_compile",
);
export const cancelCompile = callable<[], any>("cancel_compile");
export const cancelQueued = callable<[appid: number | string], any>("cancel_queued");
/** Queue row button: run that queued game now (moves it to In progress). */
export const startQueued = callable<[appid: number | string], any>("start_queued");
export const clearFinished = callable<[], any>("clear_finished");
export const pauseCompile = callable<[], any>("pause_compile");
export const resumeCompile = callable<[], any>("resume_compile");
export const clearQueue = callable<[], any>("clear_queue");
export const getCompileState = callable<[appid?: number | string], any>("get_compile_state");
export const getCompiles = callable<[], CompilesResult>("get_compiles");
/** Diagnostic channel: writes a line to homebrew/logs/SCSKiller/<date>.log. */
export const report = callable<[message: string], void>("report");
export const detect = callable<[], Detection>("detect");
export const getSettings = callable<[], Settings>("get_settings");
export const setSettings = callable<[patch: Partial<Settings>], Settings>("set_settings");
export const extractAppImage = callable<[path?: string], any>("extract_appimage");
export const openApp = callable<[], any>("open_app");
