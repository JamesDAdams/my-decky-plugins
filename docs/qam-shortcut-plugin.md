# Case study — `decky-qam-shortcut` plugin

Original goal: show a hint at the bottom of Steam Big Picture for the shortcut that opens the Decky
panel, with a different rendering per input device; then (follow-up requests) an identical design to
Steam's legends and the position immediately left of `F9 OPTIONS`.

It took three versions. The failures are documented here because they are instructive.

## v1 — floating pill drawn by the plugin

`src/overlay.ts` created a `position: fixed` `div` in `document.body`, with a dedicated `<style>`.

Result: **nothing on screen, no key captured**. Diagnosis (logging added in v1.1):

```
frontend: start href=… title=SharedJSContext size=1x1
frontend: pill visible mode=keyboard uiMode=? qam=false anyMenu=false rect=14x25@-7,-33 display=flex
```

The negative rectangle (`-7,-33`) betrays a 1×1 window: the plugin was drawing into the shared
context, not the visible window.

## v2 — injection into the real window + polling

Architecture that stuck (and is still in place):

1. the plugin injects a self-contained script into `Steam Big Picture Mode` through `executeInTab`;
2. the script draws the button, listens for clicks and the shortcut, and increments
   `window.__DECKY_HINT_REQ__`;
3. the plugin reads that counter every 700 ms and opens the QAM
   (`MenuStore.OpenQuickAccessMenu(999)`).

The mechanism worked (verified through CDP: 101×28 pill centred, click and `Ctrl+2` → counter +1,
QAM opened on tab 999) but the **design** was wrong: dark capsule, different font and spacing than
the native legends.

## v3 — clone a native legend

Instead of imitating the style, **clone** a footer item:

- find an item (`[role="img"]` near the bottom of the window, then climb to the `div` with 2 children
  whose parent has ≥ 2 children);
- `cloneNode(true)`, rename the key cap (`Ctrl+2`) and the label (`DECKY`);
- insert it **after the row's spacer** → the element lands left of `F9 OPTIONS`.

Measurements after insertion: `119×35` at `y=723` versus `94×35` at `y=723` for the neighbour
legend → same height, same alignment, same classes hence same styling.

## Shipped code layout

```
plugins/decky-qam-shortcut/
├── plugin.json              # name: DeckyShortcut (loader key), flags: ["debug"]
├── package.json             # version 2.1.1, type: module
├── main.py                  # report(message) -> decky.logger
└── src/
    ├── index.tsx            # definePlugin, QAM panel (ToggleField, ButtonItem), French copy
    ├── bridge.ts            # installPill / pollPill / destroyPill + executeInTab + polling
    ├── hint-session.ts      # 700 ms loop, counter priming, activate/openPanel
    ├── steam.ts             # MenuStore/Navigation, modes, waiting helpers (waitForQuickAccess)
    ├── config.ts            # localStorage settings (enabled, label)
    └── report.ts            # backend logging, never throws
```

Reusable pieces:

- `report()`: reliable diagnostic channel from a 1×1 window;
- `installPill`: cloning + insertion after the spacer (see the `steam-footer-legend` skill);
- counter priming on the first read (otherwise the panel opens on load);
- `activate()`: opens the Decky tab, or closes it if already shown;
- `onDismount()`: `removeHint()` + polling stop.

## Settings

`enabled` (master switch) and `label` ("Ctrl+2"). In controller mode the element is removed: native
key caps are then SVG control glyphs and the QAM button already does the job.

## What cost time (do not repeat)

1. assuming a plugin can draw in its own `document`;
2. gating the plugin on `MainInstancUIMode === 4` (undefined in `SharedJSContext`);
3. looking for a button via `position: fixed` instead of the native row;
4. believing `executeInTab` can call back into the plugin context (a counter is required);
5. treating an inherited counter value as a click.
