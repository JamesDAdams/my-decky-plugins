# Decky troubleshooting — symptom → cause → verification

This document keeps the **evidence** (log excerpts, probes); the short procedure lives in
`skills/decky-debug/SKILL.md`.

## The plugin is installed but nothing shows up

**Typical evidence** (plugin log):

```
frontend: module evaluated href=https://steamloopback.host/routes/decky/settings/developer title=SharedJSContext
frontend: start … size=1x1 uiMode=? bigPicture=true menu=true source=2
frontend: pill visible … rect=14x25@-7,-33 display=flex z=2147483000
```

The plugin *believes* it is displaying something: negative `rect`, `1x1` window, `SharedJSContext`
title. → The frontend runs in the shared context, not in the visible window.

**Check**: `node decky\tools\cdp.mjs "SharedJSContext" probe.js` returns `{w:1,h:1}`, while
`"Steam Big Picture Mode"` returns `{w:1353,h:761}`.

## The keyboard shortcut does nothing

**Evidence**: no `F8 seen …` / `request N` line in the log, although the key presses are real.

**Cause**: the listener is attached to `window` in `SharedJSContext`. Keys go to the visible window
(or to a game in the foreground).

**Check**: inject a `keydown` into the visible window through `executeInTab`, watch the counter move;
on the plugin side, watch the polling pick it up.

## The button appears in the wrong place / wrong style

**Cause**: element positioned with `position: fixed`, or CSS copied by hand.

**Check**: compare `getBoundingClientRect()` with the native neighbour — `top` and `height` must be
equal (measured: `35` and `723` for both).

## The button disappears after a while

**Cause**: React rebuilds the footer (view or input-mode change) and drops nodes it does not know.

**Check**: `document.getElementById(id)` returns `null` after a navigation; it comes back after a
re-injection.

**Fix**: re-insert on polling (check presence on every read).

## The panel does not open although `requested=true`

**Cause**: `OpenQuickAccessMenu(999)` was called but the Decky tab does not exist (Decky plugin
hidden), or the store targeted is not the active window's.

**Check**:

```js
m.GetQuickAccessTab();      // should become 999
m.IsAnySideMenuVisible();   // should become true
```

Reference measurement: before opening `{"any":false,"tab":4}`, after `{"any":true,"tab":999}`.

## The panel opens by itself on load

**Cause**: unprimed event counter — the page's inherited value (e.g. `7`) is interpreted as a click.

**Fix**: on the first successful read, adopt the current value (`lastRequest = counter`) and only
open on subsequent increments.

## The plugin does not appear in Decky at all

- invalid `plugin.json` (JSON, `name`/`author`/`flags` are mandatory);
- `main.py` erroring (the plugin has a backend: an exception at load can make it "passive" or fail);
- missing `dist/index.js` → Decky imports a 404 URL, visible as a toast error.

**Check**: `Invoke-WebRequest http://127.0.0.1:1337/plugins/<name>/dist/index.js`.

## Loading fails after a reinstall

The loader appends `?t=<timestamp>`; if an import error persists, read the message in Decky's toast
(it contains the stack). The usual causes: unresolved import (wrong preset), missing default export,
missing `type: module`.
