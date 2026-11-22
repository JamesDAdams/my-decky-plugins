import { definePlugin, toaster } from "@decky/api";
import { staticClasses } from "@decky/ui";
import { ackResult, lastResult, type LastResult } from "./api";
import { installGamePageWatcher } from "./gameWatcher";
import { report } from "./report";
import { Panel } from "./ui/Panel";

/** Two arrows in a circle: the account switch. */
const Icon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M4 8h12l-3-3M20 16H8l3 3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TERMINAL = ["done", "error", "login-failed"];
const FRESH_SECONDS = 900;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A switch restarts Steam, so this code runs in the next session and the helper may still be
 * writing its report: wait for a terminal state instead of announcing an in-between one.
 */
async function announceLastSwitch(): Promise<void> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const last: LastResult | undefined = await lastResult();
    if (!last || !last.state) return;
    if (last.consumed) return;
    if (typeof last.age === "number" && last.age > FRESH_SECONDS) return;
    if (TERMINAL.indexOf(String(last.state)) < 0) {
      await sleep(500);
      continue;
    }
    const who = last.persona || last.target || "the other account";
    const ok = last.state === "done";
    const launched = Boolean(last.appid);
    toaster.toast({
      title: "Steam Switch",
      body: ok
        ? launched
          ? `Signed in as ${who}; the game is starting.`
          : `Signed in as ${who}.`
        : `Switch did not complete (${last.state}): ${last.message || "unknown reason"}`,
      critical: false,
    });
    report(`announced ${last.state} for ${who}`);
    await ackResult();
    return;
  }
}

export default definePlugin(() => {
  let cleanup: (() => void) | undefined;
  try {
    cleanup = installGamePageWatcher();
  } catch (exc: unknown) {
    report(`install failed: ${String(exc)}`);
  }

  void announceLastSwitch().catch((exc: unknown) => report(`last result: ${String(exc)}`));

  return {
    name: "Steam Switch",
    titleView: <div className={staticClasses.Title}>Steam Switch</div>,
    content: <Panel />,
    icon: <Icon />,
    onDismount() {
      try {
        cleanup?.();
      } catch {
        // the loader is going away anyway
      }
    },
  };
});
