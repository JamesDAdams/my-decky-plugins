import { ButtonItem, PanelSection, PanelSectionRow, ToggleField, staticClasses } from "@decky/ui";
import { definePlugin, toaster } from "@decky/api";
import { useEffect, useState } from "react";

import type { HintMode } from "./bridge";
import { type HintConfig, getConfig, setConfig, subscribeConfig } from "./config";
import { HintSession } from "./hint-session";
import { report } from "./report";
import { waitForQuickAccess } from "./steam";

// Proof that the bundle was imported at all; if this line is missing from
// homebrew/logs/decky-qam-shortcut/*.log, the frontend never ran.
report(`module evaluated href=${location.href} title=${document.title}`);

/** Small keyboard glyph, drawn inline so the plugin needs no icon package. */
const PluginIcon = () => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect
      x="2.75"
      y="5.5"
      width="18.5"
      height="13"
      rx="2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    />
    <circle cx="7" cy="9.5" r="1" fill="currentColor" />
    <circle cx="10.5" cy="9.5" r="1" fill="currentColor" />
    <circle cx="14" cy="9.5" r="1" fill="currentColor" />
    <circle cx="17.5" cy="9.5" r="1" fill="currentColor" />
    <circle cx="7" cy="12.75" r="1" fill="currentColor" />
    <circle cx="10.5" cy="12.75" r="1" fill="currentColor" />
    <circle cx="14" cy="12.75" r="1" fill="currentColor" />
    <rect x="7" y="15.4" width="10.5" height="1.6" rx="0.8" fill="currentColor" />
  </svg>
);

function useConfig(): HintConfig {
  const [config, setLocalConfig] = useState<HintConfig>(getConfig());
  useEffect(() => subscribeConfig(setLocalConfig), []);
  return config;
}

function useMode(session: HintSession): HintMode {
  const [mode, setMode] = useState<HintMode>(session.getMode());
  useEffect(() => session.subscribeMode(setMode), [session]);
  return mode;
}

function Content({ session }: { session: HintSession }) {
  const config = useConfig();
  const mode = useMode(session);
  const [feedback, setFeedback] = useState<string | null>(null);

  const openPanel = async () => {
    setFeedback("Ouverture...");
    const requested = session.openPanel();
    const opened = requested && (await waitForQuickAccess(900));
    setFeedback(opened ? "Panneau Decky ouvert." : "Impossible d'ouvrir le panneau pour le moment.");
  };

  return (
    <>
      <PanelSection title={"Raccourci en bas de l'\u00e9cran"}>
        <PanelSectionRow>
          <ToggleField
            label="Activer le rappel et Ctrl+2"
            description={"Ajoute Ctrl+2 DECKY \u00e0 c\u00f4t\u00e9 de F9 OPTIONS dans la barre du bas, et active la touche Ctrl+2."}
            checked={config.enabled}
            onChange={(enabled: boolean) => setConfig({ enabled })}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={openPanel}>
            Ouvrir le panneau Decky maintenant
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title={"D\u00e9tection"}>
        <PanelSectionRow>
          <div
            style={{
              fontSize: "0.85em",
              lineHeight: 1.55,
              opacity: 0.88,
              whiteSpace: "pre-line",
            }}
          >
            {`Mode actuel : ${mode === "gamepad" ? "manette" : "clavier / souris"}\nRaccourci clavier / souris : Ctrl+2\nRaccourci manette : bouton QAM (...) de Steam${
              feedback ? `\n${feedback}` : ""
            }`}
          </div>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  const session = new HintSession({
    onActivate: (handled) => {
      if (!handled) {
        toaster.toast({
          title: "Raccourci Decky",
          body: "Le panneau Decky n'a pas pu \u00eatre ouvert.",
        });
      }
    },
  });
  session.start();

  return {
    name: "Raccourci Decky",
    titleView: <div className={staticClasses?.Title}>Raccourci Decky</div>,
    content: <Content session={session} />,
    icon: <PluginIcon />,
    onDismount() {
      session.stop();
    },
  };
});
