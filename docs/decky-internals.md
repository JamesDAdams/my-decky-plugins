# Decky / Steam Big Picture internals

Reference notes from measurements on a Windows Steam client + Decky 3 (November 2026). Quoted values
are real outputs (logs, CDP), not assumptions.

## 1. Two (or rather four) CEF windows

Steam Big Picture is not a page: it is several CEF browsers.

| Tab (CDP title) | Role | `innerWidth` |
| --- | --- | --- |
| `SharedJSContext` | shared JS context; **this is where Decky loads plugin frontends** | **1** |
| `Steam Big Picture Mode` | the visible window (what the user sees) | 1353 |
| `QuickAccess_uid2` | the QAM panel (slides in from the right) | — |
| `MainMenu_uid2`, `Menu`, `notificationtoasts_uid2` | menus and notifications | — |

Consequence: in `SharedJSContext`, `document` is a 1×1 pixel page. A `div` appended to
`document.body` is **never** visible, and a `keydown` listener on `window` **never** receives the
user's keystrokes.

Proof (plugin log):

```
frontend: module evaluated href=https://steamloopback.host/routes/decky/settings/developer title=SharedJSContext
frontend: start href=… size=1x1 uiMode=? bigPicture=true menu=true source=2 bodyKids=4
```

## 2. What each context exposes

| | `SharedJSContext` | `Steam Big Picture Mode` |
| --- | --- | --- |
| `window.SteamUIStore` | **yes** | **no** |
| `window.SteamClient` | yes | yes |
| `window.DFL` / `SP_REACT` | yes (used by plugin bundles) | no |
| visible DOM | no | yes |
| `MenuStore` (open the QAM) | yes | no |
| keyboard/mouse events | no | yes |

Hence the enforced architecture: **act from `SharedJSContext`, draw in `Steam Big Picture Mode`**.

## 3. Decky bridge: `executeInTab`

```ts
import { executeInTab } from "@decky/api";
const res = await executeInTab("Steam Big Picture Mode", false, "<self-contained js>");
// { success: boolean, result: any }
```

Loader side: `@decky/api` → websocket `utilities/execute_in_tab` → `inject_to_tab(title, …)` →
`get_tab(title)` (**exact** title match) → CDP `Runtime.evaluate`.

Limits:

- injected code is **self-contained** (no imports); obtain it by serialising a function with
  `Function.prototype.toString()`;
- the result is the evaluated return value (`returnByValue`): return a JSON string;
- a CEF window exposes no object to the plugin context: event reporting goes through a
  **counter + polling** (`window.__DECKY_HINT_REQ__` for instance);
- the window can be reloaded (UI mode change): re-inject if the target disappears.

## 4. Opening the Decky panel (QAM)

```js
var s = window.SteamUIStore;
var i = (s.GetFocusedWindowInstance && s.GetFocusedWindowInstance()) || s.WindowStore.GamepadUIMainWindowInstance;
var m = i && i.MenuStore;

m.OpenQuickAccessMenu(999);   // 999 = QuickAccessTab.Decky
// verify ~1 s later:
m.GetQuickAccessTab();        // 999
m.IsAnySideMenuVisible();     // true
m.CloseSideMenus();           // close
m.ToggleSideMenu(2);          // 2 = SideMenu.QuickAccess
```

`@decky/ui` also provides `Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky)` /
`CloseSideMenus()`, but that layer **swallows its errors**: the direct `MenuStore` call is preferable
because it can be verified, with `Navigation` as a fallback.

## 5. Modes

- **UI mode**: `SteamUIStore.MainInstancUIMode` is `4` (GamePad) / `7` (Desktop) **in a normal
  client**, but it is **undefined** in `SharedJSContext`. Never gate the plugin on `=== 4`: only
  disable it when `=== 7`.
- **Input mode**: `NavigationManager.GetSourceType()` →
  `0 UNKNOWN, 1 GAMEPAD, 2 KEYBOARD_SIMULATOR, 3 MOUSE, 4 TOUCH, 5 LPAD, 6 RPAD` (`SharedJSContext`
  only). In the visible window: DOM events + `SteamClient.Input`.

## 6. Plugin loading

```
GET http://127.0.0.1:1337/plugins/<plugin.json name>/dist/index.js
```

- the key is `plugin.json.name` (the folder name does not matter);
- the file must be an **ESM** whose default export is `definePlugin(...)`;
- `package.json` → `"type": "module"` selects ESM loading (otherwise legacy IIFE);
- the loader appends `?t=<timestamp>`: no cache to clear.

`plugin.json`: `name`, `author`, `flags` (`debug` = hot reload, `root` = privileged plugin),
`api_version` (1 → class `Plugin`), `publish`.

## 7. Backend and logging

`main.py`: `class Plugin` + `_main`, `_unload`, `_uninstall`, `_migration`; public methods callable
from the frontend; the `_` prefix is forbidden from the frontend.

Log: `homebrew/logs/<name>/<timestamp>.log`, through `decky.logger`. Recommended pattern: a public
`report(message)` method in `main.py`, called from the frontend by a `report()` helper that never
throws (see `plugins/decky-qam-shortcut/src/report.ts`).

## 8. Live verification

- `tools/cdp.mjs "<tab>" <file.js>`: evaluates a JS file in the tab and prints the return value;
- `tools/inject-bundle.mjs install|poll|destroy`: replays the plugin's **compiled script** in the
  visible window and prints its verdict;
- `Page.captureScreenshot` **times out** on this client: validate with geometry and the log.
