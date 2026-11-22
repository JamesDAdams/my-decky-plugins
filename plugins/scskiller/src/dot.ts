import { getCompiles, getStatus } from "./api";
import { KIND_COLORS } from "./format";
import { report } from "./report";
import { activeAppid } from "./ui/ScskButton";
import { uiDocument } from "./navAdopt";

/**
 * Paint the status dot of the game page button without React.
 *
 * The button must not re-render (see ScskButton): a re-render re-registers its gamepad navigation
 * node under the page container, and the controller skips it until the keeper moves it back. So the
 * dot is updated straight on the DOM element, from the same two backend calls the component used
 * to make.
 */

const RED = "#e05252";
const INTERVAL_MS = 2500;

let timer: ReturnType<typeof setInterval> | undefined;
let lastKey = "";

function plainId(value: unknown): string {
  return String(value ?? "").replace(/^steam:/, "");
}

async function tick(): Promise<void> {
  const appid = activeAppid;
  const doc = uiDocument();
  if (!appid || !doc) return;
  const dot = doc.querySelector("[data-scskiller-dot]") as HTMLElement | null;
  if (!dot) return;

  try {
    const status = await getStatus(appid, lastKey !== String(appid));
    const color = status?.ok ? KIND_COLORS[String(status.status?.kind ?? "unknown")] ?? RED : RED;
    dot.style.background = color;
    dot.style.boxShadow = `0 0 5px ${color}`;
    lastKey = String(appid);

    const running = await getCompiles();
    const job = (running?.jobs ?? []).find((item) => plainId(item.app_id) === String(appid));
    if (job?.running) {
      // a compile in progress: keep the dot on SCSKiller's own running colour
      const busy = KIND_COLORS.working ?? color;
      dot.style.background = busy;
      dot.style.boxShadow = `0 0 5px ${busy}`;
    }
  } catch {
    // the dot simply keeps its last colour
  }
}

export function installDotWatcher(): () => void {
  if (timer) return () => undefined;
  const run = () => {
    void tick();
  };
  run();
  timer = setInterval(run, INTERVAL_MS);
  return () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    report("dot watcher stopped");
  };
}
