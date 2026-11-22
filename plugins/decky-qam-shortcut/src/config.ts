/**
 * Persisted plugin settings.
 *
 * Kept in the Steam browser's localStorage: it needs no backend round-trip, it
 * survives Steam restarts, and both the QAM panel and the hint session read from
 * the same module-level store.
 */

export interface HintConfig {
  /** Master switch: the footer hint *and* its keyboard shortcut. */
  enabled: boolean;
  /** Text drawn in the key cap, e.g. "Ctrl+2". */
  label: string;
}

export const DEFAULT_CONFIG: HintConfig = {
  enabled: true,
  label: "Ctrl+2",
};

const STORAGE_KEY = "decky-qam-shortcut:config:v3";

type Listener = (config: HintConfig) => void;
const listeners = new Set<Listener>();

function read(): HintConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<HintConfig> | null;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_CONFIG };
    return {
      enabled:
        typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_CONFIG.enabled,
      label:
        typeof parsed.label === "string" && parsed.label.length > 0 && parsed.label.length <= 12
          ? parsed.label
          : DEFAULT_CONFIG.label,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

let current: HintConfig = read();

export function getConfig(): HintConfig {
  return current;
}

export function setConfig(patch: Partial<HintConfig>): HintConfig {
  current = { ...current, ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage can be unavailable (private mode, quota). The in-memory value
    // still works for this session.
  }
  for (const listener of listeners) {
    try {
      listener(current);
    } catch {
      // One broken subscriber must not prevent the others from updating.
    }
  }
  return current;
}

export function subscribeConfig(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
