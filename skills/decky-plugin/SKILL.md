---
name: decky-plugin
description: >
  Create or maintain a Decky Loader plugin for Steam Big Picture: skeleton, rollup build, Python
  backend, QAM panel, opening the Decky panel, versioning and install zip. Use whenever the task
  mentions a Decky plugin, the QAM, plugin.json, definePlugin, main.py for Decky, or packaging a
  Decky plugin.
---

# Create / maintain a Decky plugin

## Before writing a line

1. Read `decky/AGENTS.md` (measured facts, rules, pitfalls).
2. Establish where the frontend runs: on desktop Steam it is `SharedJSContext` (1×1 window) — any
   visible UI goes through `executeInTab` or a React patch. UI that is not visible is not a styling
   bug, it is a context bug.
3. Verify on the machine at the end (log + CDP). "It compiles" ≠ "it works".

## Minimal skeleton

```
<plugin>/
├── plugin.json      { name (loader key), author, flags: ["debug"], api_version: 1, publish }
├── package.json     { "type": "module", version, scripts: build/watch, deps }
├── main.py          class Plugin (api_version 1)
├── rollup.config.js import deckyPlugin from "@decky/rollup"; export default deckyPlugin({})
├── tsconfig.json    jsx: react-jsx, moduleResolution: Bundler, noEmit: true
├── src/index.tsx    export default definePlugin(() => ({ ... }))
└── dist/index.js    generated ESM bundle (required)
```

Hard constraints:

- entry must be **`src/index.tsx`** (the preset does not look for `index.ts`) with a **default export**;
- `package.json` → `"type": "module"` (otherwise Decky falls back to legacy loading);
- never bundle `react` / `@decky/ui`: the preset maps them to `SP_REACT` / `SP_JSX` / `DFL`;
- `dist/` is wiped on every build.

## index.tsx — QAM panel

```tsx
import { ButtonItem, PanelSection, PanelSectionRow, ToggleField, staticClasses } from "@decky/ui";
import { definePlugin, toaster } from "@decky/api";
import { useState } from "react";

export default definePlugin(() => ({
  name: "MyPlugin",
  titleView: <div className={staticClasses?.Title}>My plugin</div>,
  content: <MyPanel />,
  icon: <Icon />,
  onDismount() { /* remove everything: timers, listeners, injections */ },
}));
```

- `content` **is** the plugin panel inside the QAM (there is no separate registration);
- `onDismount` must be the exact mirror of what the plugin installed (timers, listeners,
  `executeInTab` destruction, React patches).

## main.py (api_version 1)

```python
import decky

class Plugin:
    async def report(self, message: str) -> None:
        decky.logger.info("frontend: %s", message)

    async def _main(self): pass
    async def _unload(self): pass
    async def _uninstall(self): pass
    async def _migration(self): pass
```

- **public** methods are callable from the frontend; anything starting with `_` is not;
- `decky.logger` writes to `homebrew/logs/<name>/*.log`: it is the only reliable diagnostic channel,
  call `report()` from the frontend (see `docs/troubleshooting.md`).

## Opening the Decky panel (QAM, tab 999)

From `SharedJSContext` (where the plugin runs):

```ts
const store = window.SteamUIStore;
const inst = store?.GetFocusedWindowInstance?.() ?? store?.WindowStore?.GamepadUIMainWindowInstance;
inst?.MenuStore?.OpenQuickAccessMenu(999);   // QuickAccessTab.Decky
inst?.MenuStore?.CloseSideMenus();
```

Verified: `GetQuickAccessTab()` becomes `999` and `IsAnySideMenuVisible()` becomes `true`.
`@decky/ui` also exposes `Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky)`, but that layer
swallows its errors — prefer the direct `MenuStore` call (verifiable) and keep `Navigation` as a
fallback.

## Injecting UI into the real window

```ts
import { executeInTab } from "@decky/api";

const res = await executeInTab("Steam Big Picture Mode", false, "<self-contained script>");
// res = { success: boolean, result: any }
```

- the **tab title** must match exactly (`Steam Big Picture Mode`);
- the injected script must be self-contained (`Function.prototype.toString()`), with no imports;
- a CEF window cannot call back into the plugin context: plan for a **counter + polling** bridge
  (see `steam-footer-legend` for the full pattern);
- the window can be reloaded: re-inject periodically if the target disappears.

## Input mode (keyboard/mouse vs controller)

- in `SharedJSContext`: `SteamUIStore.NavigationManager.GetSourceType()` →
  0 UNKNOWN, 1 GAMEPAD, 2 KEYBOARD_SIMULATOR, 3 MOUSE, 4 TOUCH, 5 LPAD, 6 RPAD;
- in the visible window (no `SteamUIStore`): `keydown` / `pointerdown` / `mousemove` for
  keyboard-mouse, `SteamClient.Input.RegisterForControllerInputMessages` for the controller;
- do not let the two sources fight: DOM events win, and Steam only takes over when its value
  **changes**.

## Inline button on a game page (React tree, not DOM)

The plugin realm has a 1×1 `document`: querying the visible page is useless. Insert a React element in
the route tree and place it absolutely over the play bar (full recipe: `decky/AGENTS.md` §3b,
reference implementation: `decky/plugins/scskiller/src/gamePageTree.tsx`):

```tsx
routerHook.addPatch("/library/app/:appid", (tree) => {
  const routeProps = findInReactTree(tree, (n) => n?.renderFunc);
  afterPatch(routeProps, "renderFunc", createReactTreePatcher(
    [(node) => { /* read overview.appid, return host?.props?.children */ }],
    (_args, ret) => {
      const container = findInReactTree(ret, (n) =>
        Array.isArray(n?.props?.children) &&
        typeof n?.props?.className === "string" &&
        n.props.className.includes(appDetailsClasses.InnerContainer));
      container?.props?.children?.splice(1, 0, (
        <div key="my-button" style={{ position: "relative", height: 0, width: "100%" }}>
          <div style={{ position: "absolute", right: 152, top: 16 }}><MyButton appid={appid} /></div>
        </div>
      ));
      return ret;
    },
  ));
  return tree;
});
```

- `InnerContainer` children: `[0]` artwork header, `[1]` play bar — splice at 1 with `height: 0` so the
  overlay lands on the icon row (`top: 16` for a 48 px button);
- `right: 152` = 16 px padding + 8 px gap + 48 px controller icon + 48 px page margin: keeps the button
  8 px left of the controller icon at any window width;
- verify with geometry in `Steam Big Picture Mode`: `2 * (icon.left - button.right)` must be `8` and
  `centerDelta === 0`.

## UI rules that bite

| Rule | Why |
| --- | --- |
| Bundle must be **pure ASCII** | Decky serves the module without charset; `—`, `·`, `…` become `â€"`, `·`, `…` in the UI. Check `dist/index.js` for ord > 127 before shipping |
| No `<SteamSpinner>` in a modal/QAM | it is a page-sized loader: giant Steam logo, stretched flex row. Use a `working...` text line |
| `noFocusRing` on custom `Focusable`s | otherwise Steam paints a grey ring around your button |
| Copy native metrics, don't invent them | icon buttons: 48×48, radius 2 px, `rgba(172,178,201,0.14)`, hover `rgba(205,213,226,0.26)`, `transition: background-color .12s ease` |
| Backend: re-read the app's own state file when possible | the CLI's per-game `status` is poorer than the JSON the app writes (e.g. 444 pipelines vs 25 803). A "refresh" should rescan and re-read the file |

## Version, build, shipping

```powershell
cd decky\plugins\<name>
npm install
npm run build                     # dist/index.js
# zip: root folder <name>/ containing plugin.json, package.json, main.py, dist/index.js, README, LICENSE
```

- the plugin version comes from `package.json` (`version`);
- a correct zip uses **forward slashes** in entry names (a `\` breaks Python extraction);
- install: Decky → ⚙️ → *Install from zip file* (reloads the plugin immediately).

## Final checklist

- [ ] `npm run build` and `tsc --noEmit` pass;
- [ ] `dist/index.js` has **no byte > 0x7F** (ASCII only);
- [ ] the bundle is an ESM whose `default` is a function;
- [ ] nothing is drawn in the `SharedJSContext` `document`;
- [ ] custom `Focusable`s carry `noFocusRing`, no `SteamSpinner` in modals;
- [ ] `onDismount` removes everything;
- [ ] the log shows startup and actions;
- [ ] backend code changes are followed by a Steam restart (the Python process is not reloaded by
      `unloadPlugin`/`importPlugin`/`restartWebhelper`);
- [ ] verified live (CDP geometry + screenshot) on the machine;
- [ ] zip regenerated and tested.
