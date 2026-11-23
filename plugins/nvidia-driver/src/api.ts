import { callable } from "@decky/api";

/** Everything the backend reports about the driver situation. */
export interface InstallState {
  phase: "idle" | "downloading" | "starting" | "installing" | "done" | "error" | "timeout" | "cancelled";
  percent: number;
  version: string;
  path: string;
  message: string;
  error: string;
  bytes: number;
  total: number;
  speed: number;
  started_at: number;
}

export interface DriverState {
  ok: boolean;
  gpu: string;
  installed: string;
  latest: string;
  update: boolean;
  name: string;
  release_date: string;
  channel: string;
  source: "nvidia-app" | "nvidia-app-log" | "none" | string;
  checked_at: number;
  error: string;
  mcp_error?: string;
  install: InstallState | null;
}

export interface InstallReply {
  ok: boolean;
  error?: string;
  version?: string;
  install?: InstallState;
}

export const getState = callable<[force?: boolean], DriverState>("get_state");
export const install = callable<[], InstallReply>("install");
export const cancelInstall = callable<[], { ok: boolean; install?: InstallState }>("cancel_install");
export const openNvidiaApp = callable<[], { ok: boolean; error?: string }>("open_nvidia_app");
export const report = callable<[message: string], void>("report");
