import { useSyncExternalStore } from "react";
import { getSnapshot, subscribe, type AppState } from "./store";

/** One shared subscription for the whole plugin: the QAM panel and the game-page row see the same data. */
export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
