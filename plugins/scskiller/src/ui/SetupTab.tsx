import { ButtonItem, PanelSection, PanelSectionRow, SliderField, TextField, ToggleField } from "@decky/ui";
import type { Detection, Settings } from "../api";
import { COLORS, Dot } from "./atoms";

/** Everything that is not the games table: detection, the CLI path and the compile
 *  settings that used to live in their own "Options" section. */
export function SetupTab({
  detection,
  settings,
  path,
  message,
  working,
  isLinux,
  injected,
  detail,
  onPathChange,
  onDetect,
  onExtract,
  onOpenApp,
  onApplyPath,
  onSave,
  onCopyDiagnostics,
}: {
  detection: Detection | null;
  settings: Settings | null;
  path: string;
  message: string | null;
  working: boolean;
  isLinux: boolean;
  injected: boolean;
  detail: string;
  onPathChange: (value: string) => void;
  onDetect: () => void;
  onExtract: () => void;
  onOpenApp: () => void;
  onApplyPath: () => void;
  onSave: (patch: Partial<Settings>) => void;
  onCopyDiagnostics: () => void;
}) {
  const resolved = detection?.resolved;
  const hint = message && message !== resolved?.error ? message : null;

  return (
    <div>
      <PanelSection title="SCSKiller">
        <PanelSectionRow>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            {working ? (
              <span>working...</span>
            ) : resolved?.ok ? (
              <>
                <Dot color={COLORS.green} />
                v{detection?.version || "?"} -{" "}
                {resolved.mode === "appimage" ? "AppImage" : resolved.mode === "exe" ? "scskiller.exe" : "CLI"}
                <div style={{ opacity: 0.6, wordBreak: "break-all" }}>{resolved.source}</div>
              </>
            ) : (
              <>
                <Dot color={COLORS.red} />
                {resolved?.error ?? "SCSKiller not found"}
              </>
            )}
            {hint ? <div style={{ marginTop: 4, opacity: 0.75 }}>{hint}</div> : null}
            <div style={{ marginTop: 6, opacity: 0.9 }}>
              Game page button:{" "}
              <span style={{ color: injected ? COLORS.green : COLORS.red }}>
                {injected ? "injected under the Play bar" : "not injected yet"}
              </span>
              {detail ? <div style={{ opacity: 0.65, fontSize: 11 }}>{detail}</div> : null}
            </div>
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onDetect} disabled={working}>
            Detect SCSKiller
          </ButtonItem>
        </PanelSectionRow>
        {detection?.gui ? (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={onOpenApp} disabled={working}>
              Open SCSKiller
            </ButtonItem>
          </PanelSectionRow>
        ) : null}
        {isLinux && detection?.appimages?.length ? (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={onExtract} disabled={working}>
              Extract the AppImage's CLI
            </ButtonItem>
          </PanelSectionRow>
        ) : null}
        <PanelSectionRow>
          <TextField
            label={isLinux ? "Path to scskiller or the AppImage (optional)" : "Path to scskiller.exe (optional)"}
            value={path}
            onChange={(event) => onPathChange(event.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onApplyPath} disabled={working}>
            Use this path
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onCopyDiagnostics}>
            Copy game page diagnostics
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Compile settings">
        <PanelSectionRow>
          <SliderField
            label="Threads (0 = SCSKiller's default)"
            value={settings?.threads ?? 0}
            min={0}
            max={16}
            step={1}
            showValue
            onChange={(value) => onSave({ threads: value })}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Compile at background priority"
            description="Nice the compile so the Deck stays responsive."
            checked={Boolean(settings?.idle)}
            onChange={(checked) => onSave({ idle: checked })}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <SliderField
            label="Auto-refresh the game page (seconds, 0 = off)"
            value={settings?.auto_refresh ?? 0}
            min={0}
            max={300}
            step={30}
            showValue
            onChange={(value) => onSave({ auto_refresh: value })}
          />
        </PanelSectionRow>
        {isLinux ? (
          <PanelSectionRow>
            <ToggleField
              label="Unpack the AppImage instead of mounting it"
              description="Needed when FUSE is missing: the AppImage self-extracts on each run."
              checked={Boolean(settings?.extract_and_run)}
              onChange={(checked) => onSave({ extract_and_run: checked })}
            />
          </PanelSectionRow>
        ) : null}
      </PanelSection>
    </div>
  );
}
