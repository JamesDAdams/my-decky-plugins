# "Deck" agent — Decky Loader / Steam Big Picture

This folder is the reference workshop for everything related to **Decky Loader** plugins on **Steam
Big Picture**: plugin sources, live verification tooling, reusable skills and technical notes based
on real measurements (not guesses).

Read this file before touching plugin code. The rest of the folder is indexed at the end.

---

## 1. Role

Build, modify, debug and ship Decky Loader plugins for Steam Big Picture, with code that **actually
works** on the Steam client (verified through logs and CDP), not just code that compiles.

## 2. Non-negotiable rules

1. **A Decky plugin is not a web page.** On desktop Steam the plugin frontend runs inside a hidden
   **1×1 pixel** CEF window (`SharedJSContext`, `innerWidth === 1`). Anything drawn in its `document`
   is invisible and no key event ever reaches it. Visible UI must be either:
   - **injected** into the `Steam Big Picture Mode` window through `executeInTab` (visible document);
   - or **rendered by a React tree patch** (the way Decky adds its own QAM tabs).
2. **Never hand-draw a button in the bottom bar.** Clone a native Steam legend: same markup, same
   classes, correct position within the row. See the `steam-footer-legend` skill.
3. `dist/index.js` must be an **ESM** whose default export is the result of `definePlugin(...)`, and
   `package.json` must contain `"type": "module"`. Otherwise Decky will not load the plugin.
4. `plugin.json` → `"name"` is **the loader key**: Decky serves the frontend from
   `http://127.0.0.1:1337/plugins/<name>/dist/index.js` and creates
   `homebrew/{plugins,logs,data,settings}/` under that name. The folder name may differ, but avoid
   spaces.
5. `api_version: 1` → a **class** `Plugin` in `main.py`, public methods callable from the frontend;
   any method starting with `_` is loader-only (calling it from the frontend is an error).
6. **Fail soft, always.** Every access to a Steam internal goes in a `try/catch` with a fallback
   (button absent, shortcut inert) — never an exception that breaks the UI.
7. **A diagnostic channel is mandatory**: the plugin must be able to write usable lines to
   `homebrew/logs/<name>/*.log` (a backend `report()` method called from the frontend).
8. **Verify on the machine**, not by eye: DOM geometry, counters, QAM state via CDP
   (`tools/cdp.mjs`, `tools/inject-bundle.mjs`). "It compiles" is not a validation.
9. **The bundle must be pure ASCII.** Decky serves `dist/index.js` without a charset; Steam decodes
   the module as Latin-1 when a byte is ≥ 0x80, so any `—`, `·`, `…`, `é` in a TSX string shows up as
   `â€"`, `Â·`, `â€¦`. Use `-`, `|`, `...` (or `\uXXXX` escapes). Check before shipping:
   `python -c "print(sorted({ord(c) for c in open('dist/index.js',encoding='utf-8').read() if ord(c)>127}))"`
   → must be `[]`. Beware: PowerShell `Get-Content -Raw | Set-Content -Encoding utf8` also *corrupts*
   sources (BOM + cp1252 round-trip) — edit files with the editor tool or Python, never that pipeline.
10. **No full-page Steam components inside a modal or the QAM.** `<SteamSpinner>` is a page-sized
    loader (giant Steam logo, stretches the flex row): use a text line (`working...`) and keep
    `flex: "0 0 auto"` on buttons. Custom `Focusable`s that must not show Steam's grey focus ring get
    `noFocusRing`.
11. **Every control must be reachable with a controller.** Decky runs on a couch: a button the mouse
    can click but the gamepad cannot focus is a bug, never an acceptable limitation. Steam's gamepad
    focus comes from **navigation nodes** (`SteamUIStore.NavigationManager.m_ActiveContext` →
    `m_rgGamepadNavigationTrees`, each node keeping its DOM element in `m_element`, its parent in
    `m_Parent`, its children in `m_rgChildren`). A DOM clone appended to a native row, or a React
    element whose node is registered under the page container instead of the row it is drawn over,
    is **outside** that tree: the controller never lands on it. Verify with
    `plugins/scskiller/tools/nav-audit.mjs` (it prints the focus parent of every navigable element)
    and fix with the `src/navAdopt.ts` helpers (`moveUnder`, `adopt`). Never ship a documented
    "mouse/keyboard only" caveat for a control you added.
    **Load the `decky-gamepad-focus` skill first** (§6): it holds the measured recipe, the four ways a
    node is ignored, and the `pad-sim.mjs` simulator, which reproduces the D-pad (`--from Play right
    right right left left`) so a "the controller cannot reach it" claim is checked in a minute instead
    of being argued about for hours.
12. **Apply rule 11 to every surface, not just the visible button.** Before declaring a plugin done,
    walk each surface with `pad-sim.mjs` and fix what the pad cannot reach: game-page controls, the
    full-page route, the QAM panel (`autoFocus` a control, otherwise the panel opens with
    `m_lastFocusNode = null` and feels dead), modal dialogs (horizontal `Focusable` footer), injected
    DOM in another window (it needs an adopted node + `vgp_onok`), the rail entry. A plain
    `<button>`/`div onClick` is not a navigation node; a `noFocusRing` control without its own
    `:focus` style is invisible to a couch user. The skill's §9 "definition of done" is the gate.
    Known open gap (2026-11-22): the top-bar status badge is injected DOM without a node - it must
    be adopted like the game-page button. (The compile overlay's Cancel was fixed in 0.9.15: in flow
    in the play bar row, adopted node, `tabindex="0"`, painted focus, `vgp_onok`.)

## 3. Measured facts (Windows, Steam + Decky 3, November 2026)

| Fact | Observed value |
| --- | --- |
| Decky frontend window | `SharedJSContext`, `innerWidth=1`, `innerHeight=1`, `document.hidden=false` |
| Visible Big Picture window | CEF title **`Steam Big Picture Mode`**, `1353×761`, has `window.SteamClient` but **not** `window.SteamUIStore` |
| CEF debug endpoint | `http://localhost:8080/json` (enabled by Decky) |
| CEF tabs | `QuickAccess_uid2`, `Steam Big Picture Mode`, `MainMenu_uid2`, `notificationtoasts_uid2`, `Menu`, `SharedJSContext` |
| Decky bridge | `executeInTab(title, runAsync, code)` from `@decky/api` → `utilities/execute_in_tab` → CDP `Runtime.evaluate`; the title must match **exactly** |
| Cross-window communication | impossible via JS objects: use a counter inside the visible window + polling from the plugin |
| `SharedJSContext` | owns `window.SteamUIStore` → `Navigation`, `MenuStore`, `NavigationManager` |
| Open the Decky panel | `MenuStore.OpenQuickAccessMenu(999)` (`QuickAccessTab.Decky = 999`) → verified: `GetQuickAccessTab() === 999`, `IsAnySideMenuVisible() === true` |
| Close it | `MenuStore.CloseSideMenus()` (or `ToggleSideMenu(2)`) |
| UI mode | `SteamUIStore.MainInstancUIMode` is **undefined** in `SharedJSContext`: never gate on `EUIMode.GamePad === 4`, only disable when `=== 7` (Desktop) |
| Input mode | `SteamUIStore.NavigationManager.GetSourceType()` (0 UNKNOWN, 1 GAMEPAD, 2 KEYBOARD_SIMULATOR, 3 MOUSE, 4 TOUCH, 5 LPAD, 6 RPAD) — `SharedJSContext` only |
| Input mode (visible window) | no `SteamUIStore` → DOM events (`keydown`, `pointerdown`, `mousemove`) + `SteamClient.Input.RegisterForControllerInputMessages` |
| Log | `%USERPROFILE%\homebrew\logs\<name>\<date>.log` (SteamOS: `/home/deck/homebrew/logs/<name>/`) |
| CDP screenshot | `Page.captureScreenshot` on the **`Steam Big Picture Mode`** target works (2730×1536 PNG on this client). Geometry still answers faster: compare `getBoundingClientRect()` of your element and the native one |
| Plugin disabled | `homebrew/settings/loader.json` → `disabled_plugins: ["<name>"]`: the plugin is never imported, and **every** bundle request returns HTTP 500 |
| Bundle HTTP 500 for *all* plugins | `homebrew/plugins` is empty (uninstalled) or the backend's plugin list is stale: reinstall the folder, then restart Steam |
| `Python KeyError` on every plugin method | the backend has no running process for that plugin (installed while Decky was running). `DeckyPluginLoader.getPluginsFromBackend()` may list it while calls still fail |
| Backend process lifetime | `unloadPlugin` / `importPlugin` / `loadPlugins` / `restartWebhelper` do **not** restart `main.py`'s process: only a Steam/Decky restart loads new Python code (check the newest file in `homebrew/logs/<name>/`) |
| Native action icon (play bar) | 48×48, `border-radius: 2px`, `background: rgba(172,178,201,0.14)`, hover `rgba(205,213,226,0.26)`, `transition: background-color .12s ease`, glyph ≈ 23 px, 8 px gap between icons, wrapper adds ~10 px padding |
| Game-page content column | `appDetailsClasses.InnerContainer` children: `[0]` artwork header, `[1]` play bar (its `props.children` is a single element, not an array) |

## 3b. Inline button on a game page — measured recipe

Target: one 48×48 icon **immediately left of the controller icon**, same look and hover as Steam's.
The plugin realm cannot query that DOM (1×1 document), so the button is a React element inserted in
the route tree and positioned absolutely over the play bar:

```tsx
routerHook.addPatch("/library/app/:appid", (tree) => {
  const routeProps = findInReactTree(tree, (n) => n?.renderFunc);
  afterPatch(routeProps, "renderFunc", createReactTreePatcher(
    [(node) => { const host = findInReactTree(node, (e) => e?.props?.children?.props?.overview);
                 appid = Number(host?.props?.children?.props?.overview?.appid);
                 return host?.props?.children; }],
    (_args, ret) => {
      const container = findInReactTree(ret, (n) =>
        Array.isArray(n?.props?.children) && n?.props?.className?.includes(appDetailsClasses.InnerContainer));
      container.props.children.splice(1, 0, (
        <div key="scskiller-button" style={{ position: "relative", height: 0, width: "100%", zIndex: 10 }}>
          <div style={{ position: "absolute", right: 152, top: 16 }}><Button appid={appid} /></div>
        </div>
      ));
      return ret;
    },
  ));
  return tree;
});
```

- insert **before** the play bar (`children[1]`, zero height) then offset down: `top: 16` puts the
  48 px button exactly on the icon row;
- `right: 152` = 16 px content padding + 8 px gap + 48 px controller icon + 48 px from the page edge
  on a 1353 px window — it keeps the button 8 px left of the icon at any width;
- the button itself: 48×48, `border-radius 2px`, `rgba(172,178,201,0.14)`, hover
  `rgba(205,213,226,0.26)`, `transition: background-color .12s ease`, `noFocusRing`;
- verify by geometry, not screenshots: read both `getBoundingClientRect()` in
  `Steam Big Picture Mode` and require `gap === 8`, `centerDelta === 0`.

Reference implementation: `plugins/scskiller/` (`src/gamePageTree.tsx`, `src/ui/ScskButton.tsx`,
`tools/cdp-*.mjs`).

## 3c. Gamepad reachability — measured recipe

A control added by a plugin is **not** reachable with a controller just because it is a `Focusable`
and looks right. What decides is its **navigation node**:

| Fact | Observed value (Windows, Steam + Decky 3, November 2026) |
| --- | --- |
| Nav trees | `SteamUIStore.NavigationManager.m_ActiveContext.m_rgGamepadNavigationTrees` (4 trees on the library, 10 on a game page) |
| Node fields | `m_Tree`, `m_Parent`, `m_rgChildren`, `m_element`, `m_nDepth`, `m_bMounted`, `m_Focused`, `m_FocusWithin`, `m_rgFocusHandlers`, `m_rgNavigationHandlers` |
| Where a plugin button lands | the overlay rendered by `routerHook.addPatch` registers under the **page container**, not the icon row: audited parent `_1SvpjsckP9cPRxO6gCBHrw Panel Focusable` instead of `_1thLDT_28YIf6OkgIb6n-4 Panel Focusable` (the icons group) |
| Fix for a React button | `moveUnder(nodeFor(button), nodeFor(iconRow))`: the node keeps its element, only its focus parent changes → audited parent becomes the icons row, next to the controller and settings icons. Two measured conditions: the node needs `m_Properties.focusable = true` (`GetFocusable()` filters on it, otherwise the node stays in the tree and the D-pad walks past it), and the element must **not re-render** - a re-render re-registers the node under the page container, so the button is state-free (CSS `:hover`/`:focus`, dot painted straight on the DOM) and a 150 ms keeper re-moves the node if it ever drifts |
| Icon row element | climb from `[aria-label="Configure Controller"]`: `parentElement.parentElement` (row > wrapper > icon) |
| Fix for a DOM clone (account page) | the clone has **no** node at all: `adopt(clone, rowNode, nodeFor(nativeChangeAccountButton))` copies the native node (prototype + fields) and points it at the clone → audited parent becomes the account button row `_1K247zQ1_VKWvLhPUceiRB Panel Focusable` |
| Left menu (`MainMenu_uid*`) | the rail lives in **another document** (`ownerDocument` of its nodes, `/routes/login`); the entry is a **DOM clone** of the Downloads row injected by `bpmMenu.ts` (`data-scsk-menu` on the cloned wrapper, `data-scsk-menu-item` on the inner `[role="menuitem"]`), and Steam focuses that inner row: `adopt(item, nodeFor(downloads).m_Parent, nodeFor(downloads))`. Focus look of a native item that is **not** the current page (to paint on the clone): `background rgba(255,255,255,0.1)`, white label and glyph, nothing else. The blue bar at the left is the **active page marker**, not the focus - painting it made SCSKiller look like the open page (reported 2026-11-22); a clone made while Downloads was the active page also copies that bar div, so every child that is neither the icon nor the label is removed |
| Focus look | Steam paints the focused icon white with a dark glyph: using `noFocusRing` means the plugin must paint that state itself (`onFocus` → white background, dark glyph), otherwise a controller user sees nothing move |
| Tools | `plugins/scskiller/tools/nav-audit.mjs` (lists navigable elements + their focus parent, `--text`, `--class`, `--near x,y`), `nav-press.mjs` (D-pad buttons and the event Steam reads), `probe-icon.js` / `probe-row-node.js` (the icons row: geometry, fiber chain, nav node) |

Shared helper: `plugins/scskiller/src/navAdopt.ts` and `plugins/steamswitch/src/navAdopt.ts`
(`navTrees`, `walkNodes`, `uiDocument`, `nodeFor`, `moveUnder`, `adopt`).

### 3d. The play bar's icon row — what actually works (measured 2026-11-22)

Going through the route patcher does **not** reach that row, and this is the important part:

| Finding | Evidence |
| --- | --- |
| The row is a focus **group**, not a focus target | its node: `GetFocusable() = "children"`, `layout = 2`, `m_rgChildren` = [controller wrapper (group, 58 px), `Manage` icon (`self`, 48 px)] |
| The row is built far below the route's element tree | route render gives elements with `navRef` (play bar) but never the row; the row is created by a `forwardRef` whose props are `parentComponent, setSections, overview, details, ...`, itself created 8+ components deeper |
| Those ancestors cannot be wrapped | Steam's minified layout is made of `{...props}` styled factories (`S`, `pt`, ...) reused everywhere: wrapping one instruments the whole UI. Wrapping only types that appear **once** in the tree leaves the descent stuck, because the containers around the play bar are all shared |
| Patching a deep `forwardRef`'s `render` works, but its output still has no row | measured: `afterPatch(type, "render", ...)` fires, the rendered output is `S kids=S,pt,S` (no `aria-label` descendants) |
| What does work: a **copy of a native node, cleaned** | `adopt()` must drop `fnCanTakeFocus` and `childFocusDisabled` from the copied `m_Properties` and force `focusable: true`. Measured 2026-11-22: a copied node that keeps the template's `fnCanTakeFocus` reports `GetFocusable() = "none"` and the controller walks past it - this alone explained every "the node is in the tree but the pad skips it" case |
| A copied node needs Steam's focus **stores**, not booleans | `m_Focused` and `m_FocusWithin` are subscribables with a `Set()` method (constructor `t`, `m_callbacks`, `m_currentValue`). `adopt()` used to write `false` there, so `node.BTakeFocus` threw `this.m_Focused.Set is not a function` - and one throw inside the traversal made the **whole focus group** unreachable. `makeFocusState()` now builds a fresh store from the template |
| A clone of a native icon **inside** the row is the right shape | cloning the row's `Manage` element (same classes, same box) as the row's first child gives the native look, the native 10 px rhythm and a button that scrolls with the play bar (measured: after `scrollTop += 120`, both the clone and the controller icon move from y=367 to y=247). It only works together with the clean node above: at 0.9.0 the same DOM insert shipped with a `GetFocusable() = "none"` node and the **whole row** became unreachable, which misread as "the DOM insert breaks React". Put the node first in `m_rgChildren`, then `EnsureChildrenSorted()` |
| The button must not be rebuilt on every Steam render | the keeper (400 ms) re-`adopt`s only when `nodeFor(button)` is empty, never re-creates the element: a new element would need a new node and lose the focus |
| A dialog's button row must be a horizontal `Focusable` | a Steam dialog is its own nav tree (`ModalDialogOverlay_Modal_<n>`, active focus tree) but its content container is **vertical** (`GetLayout() = 1`, `flexDirection: column`); a plain `div` footer is not a nav node, so its buttons became children of that vertical container and only up/down moved between them (left/right did nothing - reported as "the pad cannot select the buttons"). Wrapping the footer in `<Focusable style={{display:"flex", flexDirection:"row"}}>` fixes it: measured `Refresh -> right: Warmed -> right: Close -> A: closed, focus back on the page` |
| A focused control must *look* focused | `noFocusRing` + a custom `style` makes a button identical focused and unfocused: the pad moves (the focus log proves it) and the user still reports "the pad cannot select". Paint it: `.<class>:focus{background:#e6e8ea!important;color:#16191d!important}`. Check with a screenshot of the focused state, not just the nav tree |
| A QAM list needs **one horizontal group per row** | nested `Focusable`s do work (an older comment in `GameRow` claimed otherwise): wrapping the row in `<Focusable style={{display:"flex",flexDirection:"row"}}>` gives a node with `GetFocusable() = "children"`, `GetLayout() = 2`, children `[game (self), Compile (self)]` → measured `down: Dead by Daylight -> right: Compile -> left: row -> down: next game`. Before, the QAM's vertical container had **40 flat children** and Down walked label -> button -> next label |
| A node whose element is **detached** freezes the whole group | measured: six `down` presses in the rail left the focus on `Home`; the offending node answered `GetFocusable() = "self"` with a `0,0` rect (its clone had been rebuilt). Prune **only your own** dead nodes (`element.isConnected === false` and inside a `[data-scsk-menu]` clone) from the group, then `adopt()` again. Do **not** re-sort the rail group by hand: moving the node next to its template and calling `EnsureChildrenSorted()` froze every direction (measured right after: `down` kept the focus on `Home`); dropping that step and letting `adopt()` append the node made the walk work again (`down x6 -> SCSKiller -> ok -> /routes/scskiller`). Steam resolves the order from the geometry |
| A DOM-clone rail entry is focused on its **inner `[role="menuitem"]`** | the clone of the Downloads row can be a *wrapper*: `clone.matches('[role="menuitem"]')` is false and the focused element is `clone.querySelector('[role="menuitem"]')`. Listeners, `aria-label`, `vgp_onok` and the focus painting must go **there** (measured: otherwise the focus lands, the row stays grey and A does nothing) |
| An overlay that owns a native control's background hides its focus | the game page's Play/Resume box is repainted inline by `topBar.ts` (`rgba(220,222,223,0.17)`), so Steam's focused look never shows. Measured on a page without the overlay: a focused play button is **`rgb(89, 191, 64)`** (Focusable green) with white glyph/label - the overlay now paints that when `document.activeElement === button` |
| An adopted node needs `tabindex="0"` on its element | Steam moves the navigation focus to the node but only focuses the element when it is tab-stoppable: without it `document.activeElement` stayed on Play while the tree's `m_lastFocusNode` was the injected button, so the `focus`/`blur` painting never ran and the selection stayed invisible |
| An injected control must be **in flow** inside the row it belongs to | the compile overlay's Cancel was a `position:fixed` box next to the play button: the traversal skips it. Inserted as a 48x48 child of the play bar row (climb until the ancestor whose `flexDirection` is `row` and whose text holds `LAST PLAYED` - two levels up lands in a **column** wrapper and stacks it under the button), then `adopt()` it under that row's node |

**The D-pad can be simulated** — `plugins/scskiller/tools/pad-sim.mjs`:

```powershell
node plugins/scskiller/tools/pad-sim.mjs --from Play right right right left left   # one line per press
```

| Fact | Observed value (2026-11-22) |
| --- | --- |
| Entry point | `NavigationManager.DispatchVirtualGamepad("vgp_onbuttondown" / "vgp_onbuttonup", { button, source, is_repeat })`, `source: 1` = GAMEPAD |
| Buttons (`sp.js`) | `INVALID = 0`, `OK = 1` (A), `CANCEL = 2` (B), `SECONDARY = 3`, `DIR_UP = 9`, `DIR_DOWN = 10`, `DIR_LEFT = 11`, `DIR_RIGHT = 12` |
| Activation | Steam dispatches **`vgp_onok`** on the focused element; a cloned element has no such listener, so the pad's A does nothing while the mouse click works - add `addEventListener("vgp_onok", ...)` |
| Focus look of a clone | the native class colours the `svg` white with a stronger selector than the button's `color`: on `:focus` the glyph must be forced (`fill: #16191d !important`) or it disappears on the white focused background |
| Why earlier presses did nothing | the traversal threw on the adopted node (`m_Focused.Set is not a function`); with a valid tree the presses move the focus exactly like the hardware |
| Verified walk on the game page | `Play -> right: SCSKiller -> right: Configure Controller -> right: Manage -> left: Configure Controller -> left: SCSKiller -> left: Play` |
| What the dispatcher rejects | a tree with `BIsGamepadInputSuppressed()`, or a button while `m_rgCatchAllGamepadInput` swallows the press |
| Nothing moves at all? check the traps first | 1) Steam's `Screensaver_uid2` (the "Away" screen) swallows every gamepad press and paints a black desktop capture; an OS Shift/click does **not** reliably dismiss it (measured 2026-11-22) but `node tools/kill-screensaver.mjs` (CDP `Page.close` on that target) does — and it comes back after a couple of idle minutes, so check the target list before every walk. 2) the window: `tools/focus-bp.ps1`. 3) the surface: `MenuStore.GetOpenSideMenu()` = `0` none, `1` main menu, `2` quick access; `OpenMainMenu()` does nothing while the QAM is open, and the closed surface's nodes stay inactive so `TakeFocus` fails silently (measured 2026-11-22) |

Before claiming anything about the controller, run that walk; a "mouse only" or "not reachable" conclusion
is no longer acceptable when the presses can be reproduced.

## 4. Anatomy of a plugin

```
plugins/<name>/
├── plugin.json       # name, author, flags (["debug"] while developing), api_version: 1, publish
├── package.json      # "type": "module", version (source of the plugin version), build scripts
├── main.py           # class Plugin, _main/_unload/_uninstall/_migration + public methods
├── rollup.config.js  # import deckyPlugin from "@decky/rollup"; export default deckyPlugin({})
├── tsconfig.json     # jsx react-jsx, moduleResolution Bundler, noEmit
├── src/index.tsx     # export default definePlugin(() => ({ name, titleView, content, icon, onDismount }))
└── dist/index.js     # required ESM bundle (rollup); deleted and rebuilt on every build
```

The `@decky/rollup` preset: entry `src/index.tsx`, externals `react` → `SP_REACT`,
`react/jsx-runtime` → `SP_JSX`, `react-dom` → `SP_REACTDOM`, `@decky/ui` → `window.DFL`,
`@decky/manifest` inlined as JSON. It **wipes `dist/`** before each build: never hand-place files
there.

## 5. Working cycle

```powershell
# build
cd decky\plugins\<name>; npm install; npm run build     # or npm run watch
# or, for plugins that ship a build.ps1 (scskiller): typecheck + build + ASCII check + tests + zip
powershell -ExecutionPolicy Bypass -File .\build.ps1

# install (Decky reloads the plugin when a zip is installed)
#   Decky menu -> "Install from zip file" -> <name>-<version>.zip
# or copy into %USERPROFILE%\homebrew\plugins\<name>\ then reload Steam/Decky

# verify
node decky\tools\cdp.mjs "Steam Big Picture Mode" <file.js>      # evaluate in the visible window
node decky\tools\inject-bundle.mjs install                        # test the real compiled injected script
Get-Content "$env:USERPROFILE\homebrew\logs\<name>\*.log"        # plugin log
```

Zip rule (measured): `Compress-Archive` writes `\` in entry names and Decky's installer fails on that;
build the install zip with `python tools/release.py package <plugin> --out-dir releases` (or `zipfile`
with `as_posix()` names) so every entry uses `/`. `release.py` is the only packer: both `build.ps1`
scripts and the CI release workflow call it, and its fixed timestamps make the same sources produce the
same bytes, so the zip committed in `releases/` can be compared with the artifact of a release.

## 6. Index

**Skills** (loaded by DSH, sources in `skills/`, linked into `~/.dsh/skills/`):

- `decky-plugin` — create/maintain a plugin: skeleton, build, backend, QAM panel, opening the Decky
  panel, versioning and zip packaging.
- `steam-footer-legend` — add a button **in the right place** of the bottom bar, with the native look
  (measured recipe + pitfalls).
- `decky-gamepad-focus` — make a plugin control **reachable with the controller**: navigation nodes,
  the two focus stores Steam requires, the four ways a node is ignored, cloning a native icon of the
  row, and the `pad-sim.mjs` simulator that replays the D-pad. Read it before touching anything the
  gamepad is supposed to reach (rule 11).
- `decky-debug` — "the plugin does nothing": log, CDP, symptom → cause → verification matrix.

**Docs**:

- `docs/decky-internals.md` — Decky/Steam architecture, CEF windows, `executeInTab` bridge, QAM.
- `docs/troubleshooting.md` — detailed diagnosis matrix with evidence.
- `docs/qam-shortcut-plugin.md` — case study of the `Ctrl+2` plugin (what failed and why).
- `docs/workshop.md` — the workshop index (layout, skills, tooling, plugins).

**Tooling**: `tools/` (CDP) — see `tools/README.md`. Before any gamepad probe: `node
tools/kill-screensaver.mjs` (Steam's `Screensaver_uid2` "Away" screen swallows every press; it comes
back after idle minutes, so re-run it before each walk) then `tools/focus-bp.ps1` (brings the
`Steam Big Picture Mode` window to the foreground; `tools/wake-steam.ps1` only sends an OS input and
is not enough on its own). Plugin-specific helpers live next to their plugin
(`plugins/scskiller/tools/cdp-eval.mjs`, `cdp-reload.mjs`, `cdp-inject.mjs`, `cdp-click.mjs`,
`cdp-key.mjs`, `cdp-console.mjs`, `cdp-shot.mjs`, `nav-audit.mjs`, `nav-probe.mjs`, `pad-sim.mjs`
(gamepad simulator — `--from <label> right right left`, `--walk`, see the `decky-gamepad-focus`
skill), `open-main-menu.js` (close then open the rail: `OpenMainMenu()` alone does nothing while the
QAM is open), `probe-focus-tree.js` / `probe-active-tree.js` (node tree and per-tree children),
`probe-rail-element.js` (what the rail's adopted node points at), `open-scsk-panel.js`).
`tools/fix-mojibake.py` repairs the
UTF-8 → cp1252 → UTF-8 corruption that a PowerShell text pipeline leaves behind (see rule 9).

**Repository**: `README.md` / `README.fr.md` (the plugin listing, English default), `assets/`
(README badges), `docs/` (the website published on GitHub Pages + the technical notes),
`releases/` (installable zips, one per plugin version), `.github/workflows/release.yml` + `tools/release.py`
(one GitHub release per plugin, published from CI on every push to `main`, zip attached).

**Plugins**: `plugins/decky-qam-shortcut/` (bottom-bar shortcut, reference for footer work);
`plugins/scskiller/` (in-page React-tree button + Python backend reading a Windows app's JSON state,
reference for the game-page recipe above); `plugins/steamswitch/` (DOM/fiber rewrite of a native
Big Picture button + a detached PowerShell helper that restarts Steam on another account,
reference for "change a native button's action" and for surviving a Steam restart).

---

## 7. Public repository: layout, language, website

The folder described above **is** the public repository
<https://github.com/JamesAdams/my-decky-plugins>, and `docs/` is its GitHub Pages site
(<https://jamesdadams.github.io/my-decky-plugins/>). Anything added here is published.

```
plugins/<name>/          one folder per plugin: sources, README.md, README.fr.md, screenshots/
docs/                    the static site (index.html, styles.css, app.js, favicon.svg, .nojekyll)
docs/assets/             every image the site needs: Pages serves /docs only
releases/                installable zips; only the latest version of each plugin stays here,
                         older ones move to releases/legacy/ (gitignored)
assets/                  README badges (download-en.svg, download-fr.svg)
tools/release.py         the packer/release helper (matrix, package, notes)
.github/workflows/       release.yml: one GitHub release per plugin on every push to main
README.md / README.fr.md  root listing (English default + French)
AGENTS.md                this file
```

### Language: English first, French mirror

- **English is the default** everywhere: site, root listing, plugin READMEs.
- Every user-facing document has a French twin: root `README.fr.md`, `plugins/<name>/README.fr.md`.
  Never one mixed bilingual document.
- Each README starts with a switcher line: `**English** · [Français](README.fr.md)` in the English
  file, `[English](README.md) · **Français**` in the French one.
- The site has an `EN / FR` switch; the choice is stored in `localStorage["mdp-lang"]`. Every visible
  string goes through the `I18N` object of `docs/app.js` and a `data-i18n` (or `data-i18n-alt`)
  attribute in the HTML, whose value **is the English fallback**.
- Code, commands, file paths, log lines and Steam's own labels (`Borrow`, `Switch account & Play`,
  `F9 OPTIONS`, `Ctrl+2`) are **never** translated.

### Page layout of the website

Every plugin gets one `<article class="panel" id="panel-<plugin-folder>">` in `docs/index.html`, in
this order:

1. `.shots` — the screenshot **hero at the very top of the panel**, as a **direct child of
   `<article>`, before `.panel-body>`** (`<article> <div class="shots">…</div> <div class="panel-body">…`).
   `.shot` for a normal capture, `.shot.wide` for a bar/strip capture, `.shot.portrait` for tall ones.
   It is never inside `.panel-body` and never below the title;
2. `.panel-head` **inside `.panel-body`** — `<h2>` with the plugin name and the `<span class="tag">`
   (`Big Picture`);
3. `.lead` — one sentence: what the plugin changes, where;
4. `.feats` — three factual bullets (what it adds, where the data comes from, what stays local);
5. `.actions` — the orange `Download` button (a plain link to the raw zip in `releases/`) and a ghost
   `Details` link to the plugin folder on GitHub;
6. `.meta` — a short prerequisite, then a `.version` chip whose `data-version-src` points at the raw
   `plugins/<name>/package.json`; the site reads `"version"` from it at runtime.

The left menu lists every plugin; clicking an entry shows its panel on the right (hash routing,
`#<plugin-folder>`). The selected entry is highlighted and a direct link on a hash must open the
right panel. The menu `.nav-icon` uses the logo of the store it acts on (simple-icons path, CC0,
`viewBox="0 0 24 24"`, a single `<path>`): the three plugins all act on Steam Big Picture, so all
three use the Steam logo.

### Versions

`package.json` → `version` is the single source of the plugin version. A release means: bump it,
rebuild the bundle and the zip, drop the zip in `releases/`, update the zip URL and the static
version text in `docs/index.html` (the runtime fetch corrects it, but the static value must already be
right for crawlers and for offline copies).

### Releases: one per plugin, published by CI

`.github/workflows/release.yml` runs on **every push to `main`** (`workflow_dispatch` re-runs it) and
gives each plugin its own GitHub release:

| Item | Value |
| --- | --- |
| Tag | `<plugin.json name>-v<package.json version>`, e.g. `SCSKiller-v0.9.15` |
| Asset | `<plugin.json name>-decky-<version>.zip`, e.g. `SCSKiller-decky-0.9.15.zip` |
| Title | `<plugin.json name> <version>` |
| Body | `python tools/release.py notes <plugin>`: the `publish.description`, the three install steps (download the zip, Decky **Install from zip file**, restart Steam), and the commits that touched that plugin since its previous tag |
| Permissions | `contents: write` (the job-level `GITHUB_TOKEN`); one `concurrency` lane so two pushes never race for the same tag |

The plugin list is **discovered**, not configured: any folder under `plugins/` holding `plugin.json`
and `package.json` is built and released, so adding a plugin needs no workflow change. `tools/release.py`
is the single source of the names (`list`, `matrix`, `package`, `notes`), and it is also what both
`build.ps1` scripts call, so the local zip and the release asset have the same bytes. `matrix` prints
an **object** with an `include` key: `fromJSON` on a bare array fails the matrix expansion and the run
goes red with only the `plan` job in the job list (measured on the first run of this workflow).

The `publish` job gates the release on the same checks as the local build: `npx tsc --noEmit`,
`npx rollup -c`, the pure-ASCII check on `dist/index.js` (rule 9) and `python3 -m unittest discover -s
tests` when the plugin has tests. An artifact is never published from a red job.

Publishing is idempotent by version: when the tag already exists the job **does nothing** and says so
in the run summary — the way to publish again is to bump `package.json`, never to move a tag or edit a
release by hand. So "release on every push" means every push that ships a new version gets its release;
a documentation push keeps the runs green without rewriting an existing asset.

Runtime helpers ship only when the plugin lists them: `package.json` → `decky.ship` (measured need:
`plugins/steamswitch/package.json` → `"ship": ["tools/switch.ps1"]`), because the same `tools/` folder
also holds the dev probes (`*.mjs`, `*.js`), which must stay out of an install.

Verification of the pipeline (no `gh` CLI on this machine): the public API answers without a token —
`https://api.github.com/repos/JamesDAdams/my-decky-plugins/releases` (tags + asset names/sizes),
`.../actions/runs?per_page=3` (conclusion) and `.../actions/runs/<id>/jobs` (which step failed). Run
logs need a token, so a failure is read from the job list, not from the log.

## 8. README rules

Root listing (`README.md` / `README.fr.md`):

- a table with **three columns**: `Plugin` · `What it does` · `Installation`;
- the plugin name is a link to its folder; the description cell also holds the screenshot
  (`<br><br><img src="plugins/<name>/screenshots/…" width="260" alt="…">`), next to the text — never
  a row without an image;
- the `Installation` cell holds the download badge (`assets/download-en.svg` or `download-fr.svg`,
  96×28) linked to the raw zip in `releases/`;
- no separate "install" section: the table is the entry point.

Per-plugin README:

- line 1 language switcher, then title, one-sentence pitch, **the screenshot near the top**;
- an `## Install` / `## Installation` section with the download badge (raw URL, absolute), then the
  three steps (download the zip, Decky menu → **Install from zip file**, restart Steam) and the manual
  install line;
- what the user sees, in the order they see it; then how it works, requirements, limits/failure modes
  (a table when they can be enumerated), troubleshooting, development, license;
- the privacy/scope statement: no account, name or path hard-coded, everything read from the local
  Steam install;
- a link back to the site, `https://jamesdadams.github.io/my-decky-plugins/#<plugin-folder>`.

## 9. Screenshots

- Capture on the **real client**, at 2× when possible, cropped to the useful area, PNG.
- Store them in `plugins/<name>/screenshots/` for the READMEs **and** copy the web-sized version into
  `docs/assets/`: GitHub Pages only serves `docs/`, so a `../plugins/…` path would 404.
- Descriptive English `alt` in the HTML/README, French `alt` through `data-i18n-alt`.
- If a fresh capture is impossible (CDP `Page.captureScreenshot` hanging on an occluded window, GDI
  capture returning black on the CEF surface), crop **an existing real capture** of the same UI —
  never a mock-up, never a hand-drawn reconstruction.

## 10. Verification before pushing

- `node --check docs/app.js`, and open the site locally (`python -m http.server` inside `docs/`) and
  check: every nav entry shows its panel with the hero screenshot, `Download` points at a zip that
  exists in `releases/`, no 404 for `assets/`, the EN/FR switch translates every string and survives a
  reload, and a direct `#<plugin-folder>` link opens the right panel.
- Every internal link of `README.md`, `README.fr.md` and each plugin README resolves (folder, zip,
  screenshot).
- `plugins/*/README.md` and `README.fr.md` must be UTF-8 without BOM and contain no `?`/`\ufffd`
  replacement character: `python -c "import sys;[print(p) for p in sys.argv[1:] if '\ufffd' in
  open(p,encoding='utf-8').read()]" README.md ...` must print nothing.
- After `git push`, wait for the Pages build to finish and for the CDN copy
  (`max-age=300`) before announcing a new version.
- The committed zip must match the version: rebuild it with
  `python tools/release.py package <plugin> --out-dir releases` (or the plugin's `build.ps1`) and keep
  the README/site links on the exact name it prints - a stale badge shipped once
  (`SCSKiller-decky-0.9.10.zip` while the plugin was at 0.9.15).
- After `git push`, the **Release plugins** run is the last gate:
  `https://api.github.com/repos/JamesDAdams/my-decky-plugins/actions/runs?per_page=3` for the
  conclusion, `.../actions/runs/<id>/jobs` for the failing step (logs need a token), and
  `.../releases` for the tags with their asset names and sizes. A green run that published nothing
  means the tag already existed: bump `package.json` instead of re-running the job.
