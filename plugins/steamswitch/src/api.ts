import { callable } from "@decky/api";

/**
 * One Steam account saved on this PC (config/loginusers.vdf).
 * `id32` is the account id Steam uses everywhere in its UI (e.g. `owner_account_id`).
 */
export interface Account {
  id64: string;
  id32: number;
  account: string;
  persona: string;
  remember: boolean;
  auto: boolean;
  timestamp: number;
}

/** Result of the last switch this plugin started, as the detached helper reported it. */
export interface LastResult {
  state?: string;
  message?: string;
  appid?: number;
  target?: string;
  persona?: string;
  time?: number;
  age?: number | null;
  consumed?: boolean;
  stale?: boolean;
}

/** What the plugin knows about one game's page. */
export interface GameState {
  ok: boolean;
  supported: boolean;
  appid: number;
  installed: boolean;
  /** True only when this game belongs to another account that Steam remembers here. */
  can_switch: boolean;
  reason: string;
  owner?: Account | null;
  current?: Account | null;
  target?: Account | null;
  other?: Account[];
  name?: string;
  busy?: boolean;
}

export interface SwitchStatus {
  ok: boolean;
  supported: boolean;
  error?: string;
  steam_root?: string;
  accounts: Account[];
  current?: Account | null;
  last?: LastResult;
  busy?: boolean;
}

export interface SwitchReply {
  ok: boolean;
  error?: string;
  state?: string | GameState;
  target?: Account;
  current?: Account | null;
  appid?: number;
  user?: string;
  launched?: unknown;
}

export const getStatus = callable<[], SwitchStatus>("get_status");
export const gameState = callable<[appid: number, ownerAccountId?: number], GameState>("game_state");
export const switchAndPlay = callable<[appid: number, ownerAccountId?: number], SwitchReply>("switch_and_play");
/** Account settings page: sign the client into another remembered account, no game launch. */
export const switchAccount = callable<[account?: string], SwitchReply>("switch_account");
export const lastResult = callable<[], LastResult>("last_result");
export const ackResult = callable<[], LastResult>("ack_result");
/** Diagnostic channel: writes a line to homebrew/logs/SteamSwitch/<date>.log. */
export const report = callable<[message: string], void>("report");
