---
name: decky-debug
description: >
  Diagnose a Decky plugin that does not show up, shows up in the wrong place, or whose shortcut does
  nothing, on Steam Big Picture. Use whenever a plugin is "installed but invisible", "the button
  never appears", "the key does nothing", or to check a plugin's live state through logs and the
  DevTools protocol (CDP).
---

# Debugging a Decky plugin that does nothing

Order of work: **log → served bundle → target window → injection → action**. Do not guess, do not
edit before reading the log.

## 1. The log (30 seconds)

```
Windows : %USERPROFILE%\homebrew\logs\<plugin name>\*.log
SteamOS : /home/deck/homebrew/logs/<plugin name>/*.log
```

The plugin should write at least: `module evaluated` (bundle imported), `start …` (context), then the
action steps (`inject …`, `request …`, `openPanel …`).

| Observation | Likely cause | Next step |
| --- | --- | --- |
| no `module evaluated` line | the frontend was never imported | look for Decky's error toast, check `dist/index.js` and `"type": "module"` |
| `start href=… title=SharedJSContext size=1x1` | normal: the plugin runs in the hidden window | do not draw in `document`; inject through `executeInTab` |
| `inject refused … small-window` | wrong CEF tab targeted (1×1) | target `Steam Big Picture Mode` |
| `inject failed: no big-picture tab accepted` | window absent (desktop mode) or different title | list the tabs (step 3) |
| `pill visible` but nothing on screen | the plugin drew into its own 1×1 window | see rule 1 |
| no `request` line | key/click events never reach this context | same cause: wrong window |
| `openPanel -> requested=true` then nothing | wrong QAM tab id, or the panel is hidden | check `GetQuickAccessTab()` (step 6) |

## 2. Is the bundle served?

```powershell
Invoke-WebRequest "http://127.0.0.1:1337/plugins/<plugin.json name>/dist/index.js" -UseBasicParsing |
  Select-Object StatusCode, RawContentLength
```

- 200 + size of `dist/index.js` → the loader knows the plugin and serves the bundle;
- 404 → `plugin.json.name` is not the loader key, or `dist/index.js` is missing.

## 3. Which windows exist?

```powershell
node decky\tools\cdp.mjs "SharedJSContext" <file.js>            # plugin context (1×1)
node decky\tools\cdp.mjs "Steam Big Picture Mode" <file.js>     # visible window
```

Or directly: `Invoke-WebRequest http://localhost:8080/json`.

Observed titles: `QuickAccess_uid2`, `Steam Big Picture Mode`, `MainMenu_uid2`,
`notificationtoasts_uid2`, `Menu`, `SharedJSContext`. Port 8080 is the CEF debug endpoint provided by
Decky.

## 4. Useful probes (visible window)

```js
// context and sizes
JSON.stringify({ w: innerWidth, h: innerHeight, store: !!window.SteamUIStore, client: !!window.SteamClient })
```

- `w`/`h` ≈ 1 → wrong window;
- `store:false` → normal in the visible window: `MenuStore` is only usable from
  `SharedJSContext`;
- `client:true` → controller events (`SteamClient.Input…`) are available here.

## 5. Is the injected script working?

```powershell
node decky\tools\inject-bundle.mjs install   # replays the REAL compiled script
node decky\tools\inject-bundle.mjs poll      # counter + presence + mode
node decky\tools\inject-bundle.mjs destroy   # cleanup
```

Expected: `{"ok":true,"showing":true,"inserted":true,"rect":[w,h,left,top]}` then
`{"req":N,"pill":true,"mode":"keyboard","w":…,"h":…}`.

## 6. Opening the panel

```js
var s = window.SteamUIStore;
var i = (s.GetFocusedWindowInstance && s.GetFocusedWindowInstance()) || s.WindowStore.GamepadUIMainWindowInstance;
var m = i && i.MenuStore;
m.OpenQuickAccessMenu(999);
// then, ~1 s later:
JSON.stringify({ any: m.IsAnySideMenuVisible(), tab: m.GetQuickAccessTab() });
```

Expected: `{"any":true,"tab":999}` (= `QuickAccessTab.Decky`). Otherwise the Decky tab does not exist
/ is hidden, or another version changed the id.

## 7. Causes already encountered (by frequency)

1. **UI drawn inside `SharedJSContext`** (1×1): invisible, keys lost.
2. **Wrong CEF tab** targeted by `executeInTab` (the title must match exactly).
3. **Too strict UI-mode gate**: `MainInstancUIMode` is undefined in `SharedJSContext`; only disable
   when `=== 7` (Desktop).
4. **React rebuilds the footer** and removes the injected element → re-insert on polling.
5. **Counter not primed**: an inherited value triggers an action on load.
6. **`dist/index.js` not ESM** or no default export → the loader fails silently on the UI side.
7. **Browser cache**: reinstall the zip (the loader appends `?t=<timestamp>` to the import).

## 8. Failure modes confirmed on hardware (2026-11)

| Symptom | Real cause | Proof | Fix |
| --- | --- | --- | --- |
| Nothing ever appears, **every** `/plugins/<name>/dist/index.js` returns **HTTP 500** | `homebrew/plugins` is empty (uninstalled) or `homebrew/settings/loader.json` has `disabled_plugins: ["<name>"]` | `Get-Content ...\settings\loader.json`; `(Get-ChildItem ...\plugins).Count`; fetch the bundle | reinstall the folder, remove the name from `disabled_plugins`, restart Steam |
| Frontend loads (bundle 200) but **every** plugin method throws `Python KeyError` | the backend has no process for that plugin (folder installed while Decky ran; registry never rescanned) | `DeckyPluginLoader.getPluginsFromBackend()` lists it while `api.call(...)` fails | restart Steam so the backend rescans; `loadPlugins()`/`restartWebhelper()` are **not** enough |
| Text rendered as `â€"`, `·`, `…` | the bundle contains bytes > 0x7F and Steam decodes the module as Latin-1 | `python -c "print(sorted({c for c in open('dist/index.js',encoding='utf-8').read() if ord(c)>127}))"` | keep the bundle ASCII; never rewrite sources with `Get-Content -Raw \| Set-Content -Encoding utf8` |
| A huge Steam logo appears in a modal and the buttons stretch | `<SteamSpinner>` used inside the dialog (it is a page-sized loader) | screenshot / DOM: big `img`/svg inside the modal, flex row height jumps | render `working...` text instead |
| Grey outline around custom buttons | Steam's `Focusable` default focus ring | `getComputedStyle(btn).outline` / visible ring on focus | add `noFocusRing` to the `Focusable` |
| Button "in the wrong place" after a tree patch | insertion anchor wrong: index 0 lands on the artwork header, `props.children` of the play bar is a single element | compare `getBoundingClientRect()` of your element and the native icon in `Steam Big Picture Mode` | splice at `InnerContainer.children[1]` with `height: 0`, then position `absolute` (`right: 152`, `top: 16`) |
| `main.py` change has no effect | the plugin's Python process is never restarted by `unloadPlugin` / `importPlugin` / `loadPlugins` / `restartWebhelper` | newest file in `homebrew/logs/<name>/` keeps its old timestamp | restart Steam (or relaunch Decky) |

Verification helpers (copy into the plugin's `tools/`, they target the CEF endpoint on 8080):

```powershell
node tools/cdp-eval.mjs "<js>" "SharedJSContext"            # plugin context: globals, Decky API
node tools/cdp-eval.mjs "<js>" "Steam Big Picture Mode"     # visible DOM: geometry, text, clicks
node tools/cdp-reload.mjs <PluginName> <version>            # unload + import the plugin frontend
node tools/cdp-inject.mjs                                   # import dist/index.js as a data: URL (no reinstall)
node tools/cdp-click.mjs <x> <y> [target]                   # trusted Input.dispatchMouseEvent
node tools/cdp-key.mjs Escape [target]                      # trusted key press (dismiss a modal)
node tools/cdp-console.mjs 10 "[tag]"                       # capture console lines
node tools/cdp-shot.mjs shot.png [target]                   # Page.captureScreenshot -> PNG
```

Typical sequence for "the button is wrong / does nothing":
`cdp-eval` on `SharedJSContext` for `DeckyPluginLoader.plugins`, the plugin method (`api.call`) and the
`__SCSK_DIAG__`-style flag → then geometry on `Steam Big Picture Mode` → then `cdp-click` → then
`cdp-shot` as evidence.

## 9. What to ask the user

- the exact path of `homebrew/logs/<name>/` and its last 20 lines;
- the Steam client version and the mode (desktop Big Picture vs SteamOS);
- a screenshot of the bottom bar (if the button is there but styled wrong).
