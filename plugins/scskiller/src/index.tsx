import { addEventListener, definePlugin, removeEventListener, routerHook, toaster } from "@decky/api";
import { staticClasses } from "@decky/ui";
import { getStatus } from "./api";
import { installMenuEntry, openPage } from "./bpmMenu";
import { installDotWatcher } from "./dot";
import { installGamePageButton } from "./gamePageTree";
import { installGamepadFix } from "./gamepadFix";
import { addMenuEntry, MENU_ROUTE } from "./menuEntry";
import { appendJobLine, patchJob, setStatus } from "./store";
import { decorateToastLogo } from "./toastLogo";
import { installTopBar } from "./topBar";
import { CompilesPage } from "./ui/CompilesPage";
import { Panel } from "./ui/Panel";

const Icon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
    <path d="M13 2 4.5 13.2c-.4.5 0 1.3.6 1.3H10l-1 7.5L19.5 10c.4-.5 0-1.3-.6-1.3H14l1-6.7Z" />
  </svg>
);

interface CompileLinePayload {
  app_id: string;
  line: { text: string; stage?: string | null; error?: string | null; time?: string };
}

interface CompileStartedPayload {
  app_id: string;
}

interface CompileDonePayload {
  app_id: string;
  ok: boolean;
  exit_code?: number | null;
  error?: string | null;
}

export default definePlugin(() => {
  // Registered once, outside the panel component: the QAM unmounts, these do not.
  const onStarted = addEventListener<[payload: CompileStartedPayload]>("scsk_compile_started", (payload) => {
    patchJob(payload.app_id, {
      running: true,
      ok: null,
      error: null,
      stage: "",
      lines: [],
      started_at: Date.now() / 1000,
      finished_at: undefined,
    });
  });

  const onLine = addEventListener<[payload: CompileLinePayload]>("scsk_compile_line", (payload) => {
    appendJobLine(payload.app_id, payload.line);
  });

  const onDone = addEventListener<[payload: CompileDonePayload]>("scsk_compile_done", (payload) => {
    patchJob(payload.app_id, {
      running: false,
      ok: payload.ok,
      exit_code: payload.exit_code ?? null,
      error: payload.error ?? null,
      finished_at: Date.now() / 1000,
    });
    // the compile changed what SCSKiller has warmed: refresh that game's status so the
    // dots on the game page, the QAM rows and the badges stop showing the old state
    const appid = String(payload.app_id ?? "").replace(/^steam:/, "");
    const stopped = payload.error === "stopped";
    const title = stopped
      ? "SCSKiller: compile stopped"
      : payload.ok
        ? "SCSKiller: compile finished"
        : "SCSKiller: compile failed";
    const raw = String(payload.app_id ?? "");
    const finish = (name: string) => {
      const label = name || raw;
      toaster.toast({
        title,
        body: stopped
          ? `${label} stopped; SCSKiller keeps what it already compiled`
          : payload.ok
            ? `${label} is compiled`
            : payload.error ?? `${label} did not compile`,
        // not critical: a critical toast opens a Big Picture modal that blocks the page
        // until it is dismissed, and a failed compile must never do that
        critical: false,
      });
      decorateToastLogo(appid, title);
    };
    if (!appid) {
      finish("");
    } else {
      // the toast has to name the game, not "steam:381210": one status call gives the name
      getStatus(appid, true)
        .then((status) => {
          setStatus(appid, status);
          finish(String(status?.name ?? ""));
        })
        .catch(() => finish(""));
    }
  });

  const cleanupGamePage = installGamePageButton();
  const cleanupMenu = installMenuEntry(openPage);
  const cleanupTopBar = installTopBar(openPage);
  // every control this plugin draws has to be reachable with a controller (AGENTS.md rule 11)
  const cleanupGamepad = installGamepadFix();
  const cleanupDot = installDotWatcher();

  // full page + left-menu entry + top-right status icon (all three removeable on dismount)
  let menuInstalled = false;
  try {
    routerHook.addRoute(MENU_ROUTE, CompilesPage);
    routerHook.addPatch("/", addMenuEntry);
    menuInstalled = true;
  } catch (exc) {
    void toaster.toast({ title: "SCSKiller", body: `could not install the page: ${String(exc)}` });
  }

  return {
    name: "SCSKiller",
    titleView: <div className={staticClasses.Title}>SCSKiller</div>,
    content: <Panel />,
    icon: <Icon />,
    onDismount() {
      removeEventListener("scsk_compile_started", onStarted);
      removeEventListener("scsk_compile_line", onLine);
      removeEventListener("scsk_compile_done", onDone);
      cleanupGamePage();
      cleanupMenu();
      cleanupTopBar();
      cleanupGamepad();
      cleanupDot();
      if (menuInstalled) {
        try {
          routerHook.removePatch("/", addMenuEntry);
          routerHook.removeRoute(MENU_ROUTE);
        } catch {
          // the loader is going away anyway
        }
      }
    },
  };
});
