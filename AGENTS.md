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
| Fix for a React button | `moveUnder(nodeFor(button), nodeFor(iconRow))`: the node keeps its element, only its focus parent changes → audited parent becomes the icons row, next to the controller and settings icons |
| Icon row element | climb from `[aria-label="Configure Controller"]`: `parentElement.parentElement` (row > wrapper > icon) |
| Fix for a DOM clone (account page) | the clone has **no** node at all: `adopt(clone, rowNode, nodeFor(nativeChangeAccountButton))` copies the native node (prototype + fields) and points it at the clone → audited parent becomes the account button row `_1K247zQ1_VKWvLhPUceiRB Panel Focusable` |
| Left menu (MainMenu_uid2) | the rail lives in **another document** (`ownerDocument` of its nodes, `/routes/login`); each item is a 240 px `div.Panel.Focusable`; a plugin page object renders with the right look but **without** a node → `adopt(item, nodeFor(downloads).m_Parent, nodeFor(downloads))` |
| Focus look | Steam paints the focused icon white with a dark glyph: using `noFocusRing` means the plugin must paint that state itself (`onFocus` → white background, dark glyph), otherwise a controller user sees nothing move |
| Tools | `plugins/scskiller/tools/nav-audit.mjs` (lists navigable elements + their focus parent, `--text`, `--class`, `--near x,y`) and `nav-probe.mjs` (keyboard/gamepad direction probe) |

Shared helper: `plugins/scskiller/src/navAdopt.ts` and `plugins/steamswitch/src/navAdopt.ts`
(`navTrees`, `walkNodes`, `uiDocument`, `nodeFor`, `moveUnder`, `adopt`).

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
build zips with `python tools/make_zip.py <folder> <out.zip>` (or `zipfile` with `as_posix()` names) so
every entry uses `/`.

## 6. Index

**Skills** (loaded by DSH, sources in `skills/`, linked into `~/.dsh/skills/`):

- `decky-plugin` — create/maintain a plugin: skeleton, build, backend, QAM panel, opening the Decky
  panel, versioning and zip packaging.
- `steam-footer-legend` — add a button **in the right place** of the bottom bar, with the native look
  (measured recipe + pitfalls).
- `decky-debug` — "the plugin does nothing": log, CDP, symptom → cause → verification matrix.

**Docs**:

- `docs/decky-internals.md` — Decky/Steam architecture, CEF windows, `executeInTab` bridge, QAM.
- `docs/troubleshooting.md` — detailed diagnosis matrix with evidence.
- `docs/qam-shortcut-plugin.md` — case study of the `Ctrl+2` plugin (what failed and why).
- `docs/workshop.md` — the workshop index (layout, skills, tooling, plugins).

**Tooling**: `tools/` (CDP) — see `tools/README.md`. Plugin-specific helpers live next to their plugin
(`plugins/scskiller/tools/cdp-eval.mjs`, `cdp-reload.mjs`, `cdp-inject.mjs`, `cdp-click.mjs`,
`cdp-key.mjs`, `cdp-console.mjs`, `cdp-shot.mjs`, `nav-audit.mjs`, `nav-probe.mjs`).
`tools/fix-mojibake.py` repairs the
UTF-8 → cp1252 → UTF-8 corruption that a PowerShell text pipeline leaves behind (see rule 9).

**Repository**: `README.md` / `README.fr.md` (the plugin listing, English default), `assets/`
(README badges), `docs/` (the website published on GitHub Pages + the technical notes),
`releases/` (installable zips, one per plugin version).

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
