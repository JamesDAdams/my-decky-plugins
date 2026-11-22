# CDP tooling

Small Node scripts (native WebSocket, no dependencies) to drive the Steam client live. Decky enables
CEF debugging on `http://localhost:8080`, which exposes the tabs.

## `cdp.mjs` — evaluate JS in a tab

```powershell
node decky\tools\cdp.mjs "Steam Big Picture Mode" my-file.js
node decky\tools\cdp.mjs "SharedJSContext" my-file.js
```

Prints the return value (a string as-is, otherwise JSON). Exit codes: `0` OK, `1` tab not found,
`2` JS exception. The file must contain an **expression** (usually an IIFE returning a JSON string).

## `inject-bundle.mjs` — test the plugin's real script

```powershell
node decky\tools\inject-bundle.mjs install   # installs the button (compiled code from dist/index.js)
node decky\tools\inject-bundle.mjs poll      # counter, presence, mode
node decky\tools\inject-bundle.mjs destroy   # removes the button
```

It extracts `installPill` / `pollPill` / `destroyPill` from the compiled bundle: what gets tested is
exactly what the plugin ships. This is the check to run before delivering.

## `shot.mjs` — screenshot

```powershell
node decky\tools\shot.mjs "Steam Big Picture Mode" shot.png
```

⚠️ On this client `Page.captureScreenshot` **times out**: the tool exists for machines where it
works. To validate a rendering, prefer geometry (`getBoundingClientRect`, `getComputedStyle`).

## Ready-made probes

| File | What it returns |
| --- | --- |
| `probe-footer.js` | ancestor chain of the `OPTIONS` / `F9` labels |
| `probe-footer2.js` | text elements of the bottom row (rect + classes) |
| `probe-footer3.js` | markup of a native item + its parent row |
| `probe-imgs.js` | `[role="img"]` key caps and their ancestors |
| `probe-order.js` | order and geometry of the row's children |
| `probe-survive.js` | presence/state of the injected button |
| `test-click.js` | clicks and sends `Ctrl+2`, returns the counter delta |
| `inject-footer.js` | standalone version of the injection (prototype, before plugin integration) |

## Reminder

- target `Steam Big Picture Mode` for the DOM, `SharedJSContext` for `SteamUIStore` / `MenuStore`;
- bridge events are reported through a counter (`window.__DECKY_HINT_REQ__`) + polling;
- always clean up after a test (`inject-bundle.mjs destroy`) so no inert button is left behind.
