import type { CompileSnapshot, GameStatus, LineInfo, LibraryResult } from "./api";

export interface AppState {
  statuses: Record<string, GameStatus>;
  jobs: Record<string, CompileSnapshot>;
  library?: LibraryResult;
  // bump to force subscribers to re-render even when only a nested value changed
  revision: number;
}

let state: AppState = { statuses: {}, jobs: {}, revision: 0 };
const listeners = new Set<() => void>();

export function getSnapshot(): AppState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(next: AppState): void {
  state = next;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // a broken subscriber must not break the others
    }
  });
}

function key(appid: number | string): string {
  return String(appid);
}

export function setStatus(appid: number | string, status: GameStatus): void {
  commit({
    ...state,
    statuses: { ...state.statuses, [key(appid)]: status },
    revision: state.revision + 1,
  });
}

export function setLibrary(library: LibraryResult): void {
  commit({ ...state, library, revision: state.revision + 1 });
}

export function setJob(job: CompileSnapshot): void {
  commit({
    ...state,
    jobs: { ...state.jobs, [job.app_id]: job },
    revision: state.revision + 1,
  });
}

export function patchJob(appId: string, patch: Partial<CompileSnapshot>): void {
  const current = state.jobs[appId] ?? { app_id: appId, running: true, lines: [] };
  commit({
    ...state,
    jobs: { ...state.jobs, [appId]: { ...current, ...patch } },
    revision: state.revision + 1,
  });
}

/** Replace the job map with the backend's view (used when the panel opens: compiles
 *  started before the panel existed are only known to the backend). */
export function setJobs(jobs: CompileSnapshot[]): void {
  const next: Record<string, CompileSnapshot> = {};
  for (const job of jobs) {
    const current = state.jobs[job.app_id];
    // keep the lines this frontend already collected: the backend snapshot is shorter
    next[job.app_id] = current && (current.lines?.length ?? 0) > (job.lines?.length ?? 0)
      ? { ...job, lines: current.lines }
      : job;
  }
  commit({ ...state, jobs: next, revision: state.revision + 1 });
}

const MAX_LINES = 200;

export function appendJobLine(appId: string, line: LineInfo): void {
  const current = state.jobs[appId] ?? { app_id: appId, running: true, lines: [] };
  const lines = [...(current.lines ?? []), line].slice(-MAX_LINES);
  commit({
    ...state,
    jobs: {
      ...state.jobs,
      [appId]: { ...current, lines, stage: line.stage || current.stage },
    },
    revision: state.revision + 1,
  });
}

export function clearJob(appId: string): void {
  const jobs = { ...state.jobs };
  delete jobs[appId];
  commit({ ...state, jobs, revision: state.revision + 1 });
}
