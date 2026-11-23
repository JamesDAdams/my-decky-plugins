import { definePlugin } from "@decky/api";
import { staticClasses } from "@decky/ui";
import { getState, report } from "./api";
import { openDeckyPluginPage } from "./decky";
import { installTopBar, pushTopBar, setTopBarState } from "./topBar";
import { Panel } from "./ui/Panel";

const PLUGIN_KEY = "NvidiaDriver";
const REFRESH_MS = 10 * 60 * 1000;

const Icon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M12 3v10" />
    <path d="M7.8 9.4 12 13.6l4.2-4.2" />
    <path d="M5 19h14" />
  </svg>
);

export default definePlugin(() => {
  const open = () => {
    const ok = openDeckyPluginPage(PLUGIN_KEY);
    if (!ok) report("could not open the Decky panel (no MenuStore)");
  };

  const cleanupTopBar = installTopBar(open);

  const refresh = async () => {
    try {
      const state = await getState(false);
      setTopBarState({ update: Boolean(state.update), version: state.latest || "" });
      pushTopBar();
      report(
        `state: installed=${state.installed || "?"} latest=${state.latest || "?"} update=${Boolean(
          state.update,
        )} source=${state.source}`,
      );
    } catch (exc) {
      report(`state refresh failed: ${String(exc)}`);
    }
  };

  refresh();
  const timer = window.setInterval(refresh, REFRESH_MS);

  return {
    name: PLUGIN_KEY,
    titleView: <div className={staticClasses?.Title}>NVIDIA Driver</div>,
    content: <Panel />,
    icon: <Icon />,
    onDismount() {
      window.clearInterval(timer);
      cleanupTopBar();
    },
  };
});
