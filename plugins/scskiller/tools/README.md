# QAM verification helpers (Windows Steam + Decky)

These scripts were used to measure the Quick Access Menu and to check the panel after a
change. They are developer tools: they are **not** part of the plugin zip.

Prerequisite: Decky's CEF endpoint on `http://localhost:8080/json` (Decky enables it).

```powershell
# open the Decky QAM tab on the SCSKiller page and evaluate a snippet inside it
node plugins/scskiller/tools/qam-probe.mjs plugins/scskiller/tools/verify-all.js 2500

# what the panel should report: tab column ~806px, GAME/SHADERS/PIPELINES/CACHE/TIME/STATUS,
# the three tabs, a loaded logo (naturalWidth > 0) and the numeric cells of the first row
node plugins/scskiller/tools/qam-probe.mjs plugins/scskiller/tools/verify-all.js 2500

# only this plugin's tab panel is uncapped; Steam's own tabs keep max-width: 300px
node plugins/scskiller/tools/qam-probe.mjs plugins/scskiller/tools/verify-scope.js 3000

# narrow-QAM fallback: force the panel to 300px, the rows must fold into one mono line
node plugins/scskiller/tools/qam-probe.mjs plugins/scskiller/tools/verify-compact3.js 2500

# what the QAM really shows: visible strip (screen - window left), panel width, overflow
node plugins/scskiller/tools/qam-probe.mjs plugins/scskiller/tools/verify-strip.js 2500
node plugins/scskiller/tools/qam-probe.mjs plugins/scskiller/tools/verify-compact-fit.js 2500

# end-to-end compile: click Compile on Dying Light, then Stop (leaves a real cache entry)
node plugins/scskiller/tools/qam-probe.mjs plugins/scskiller/tools/test-start-compile.js 2500
node plugins/scskiller/tools/qam-probe.mjs plugins/scskiller/tools/test-stop-compile.js 2000

# screenshot the QAM view (Page.bringToFront first; plain Page.captureScreenshot hangs)
node plugins/scskiller/tools/cdp-shot2.mjs "$env:TEMP\qam.png" QuickAccess_uid2

# window/viewport geometry of a CEF tab
node plugins/scskiller/tools/window-bounds.mjs QuickAccess_uid2

# --- game page: the compile strip over the Play button -------------------------------
# run the injected top-bar script straight out of src/topBar.ts and measure the strip
# (no build, no Steam restart): prints page appid, Play button rect, strip rect, its text
node plugins/scskiller/tools/probe-play-strip.mjs 381210 0.072

# screenshot the whole Big Picture window even when the view is occluded
powershell -ExecutionPolicy Bypass -File plugins/scskiller/tools/cdp-shot-window.ps1 "$env:TEMP\bpm.png"

# does the frontend ask for a fresh status when a compile ends? kills the compile after 8 s
# and lists the scskiller.exe CLI invocations: a "status" line right after the kill proves it
powershell -ExecutionPolicy Bypass -File plugins/scskiller/tools/watch-status-refresh.ps1 -KillAfter 8
```

Notes measured on this client (Steam Big Picture, 1353x761 CSS, DPR 2.84):

- `QuickAccess_uid2` is the QAM view: `innerWidth` 855, its column for plugin content 806;
- Steam caps every QAM tab panel at `max-width: 300px` (its own Friends tab lifts it);
- a panel element must be reached through a DOM ref: the plugin's own `document` is 1x1 px;
- `Page.captureScreenshot` only answers after `Page.bringToFront` on this build;
- `location.pathname` stays `/index.html` in the Big Picture window: the appid of the displayed
  game has to come from the play bar's React fibres (`memoizedProps.overview.appid`);
- `Page.captureScreenshot` also hangs on an occluded view: `cdp-shot-window.ps1` uses `PrintWindow`
  instead (it misses composited buttons, so geometry is still the authority);
- a `critical` Decky toast leaves Big Picture inert once it is gone: the compile result toast is
  non-critical.
