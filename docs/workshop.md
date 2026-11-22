# decky/ — Decky Loader workshop

Everything about **Decky Loader** plugins for **Steam Big Picture**: the `Ctrl+2` plugin source, a
reference agent, reusable skills, technical notes and live verification tooling.

## Layout

```
decky/
├── AGENTS.md                  # the "Deck" agent: role, rules, measured facts, index
├── agent/
│   └── deck.md                # profile + ready-to-use prompt to spawn the agent
├── skills/
│   ├── decky-plugin/          # create / maintain a plugin
│   ├── steam-footer-legend/   # native-looking button in the right place of the bottom bar
│   └── decky-debug/           # "the plugin does nothing": diagnosis
├── docs/
│   ├── decky-internals.md     # architecture, CEF windows, executeInTab, QAM
│   ├── troubleshooting.md     # symptom → cause → verification
│   └── qam-shortcut-plugin.md # case study of the shipped plugin
├── plugins/
│   ├── decky-qam-shortcut/    # bottom-bar shortcut: TypeScript + Python + dist/
│   └── scskiller/             # in-page game button + Windows app backend (reference for the
│                              #   React-tree placement recipe in AGENTS.md 3b)
├── releases/
│   ├── decky-qam-shortcut-2.1.1.zip   # zips ready to install through Decky
│   └── SCSKiller-decky-0.6.6.zip
└── tools/                     # CDP: evaluate JS, test the bundle, probe the DOM
```

Each plugin keeps its own live-verification helpers next to its sources (`plugins/<name>/tools/`:
`cdp-eval`, `cdp-reload`, `cdp-inject`, `cdp-click`, `cdp-key`, `cdp-console`, `cdp-shot`).

## Skills

Skills are **loaded by DSH** from `~/.dsh/skills/`. Sources live here and are linked there through
directory junctions (single copy, no drift):

```powershell
cmd /c mklink /J "$env:USERPROFILE\.dsh\skills\decky-plugin"        ".\decky\skills\decky-plugin"
cmd /c mklink /J "$env:USERPROFILE\.dsh\skills\steam-footer-legend" ".\decky\skills\steam-footer-legend"
cmd /c mklink /J "$env:USERPROFILE\.dsh\skills\decky-debug"         ".\decky\skills\decky-debug"
```

A skill created here shows up in a DSH session only on the **next start** (the catalog is snapshotted
when the session opens). To use it immediately, read its `SKILL.md` and apply it.

## Using the agent

`agent/deck.md` holds the prompt to pass to `spawn_teammate` (Agent Teams mode) to get a Decky
specialist that knows this workshop:

> "Read `decky/AGENTS.md` and `decky/agent/deck.md`, then work on …"

## Build / install a plugin

```powershell
cd decky\plugins\<name>
npm install
npm run build            # -> dist/index.js (ESM, must stay ASCII: see AGENTS.md rule 9)
```

Install: Decky Loader → ⚙️ → *Install from zip file*, or copy the folder into
`%USERPROFILE%\homebrew\plugins\` and reload.

Before shipping any plugin: `dist/index.js` contains no byte > 0x7F, custom `Focusable`s use
`noFocusRing`, no `SteamSpinner` inside a modal, and backend changes are followed by a Steam restart
(the Python process survives `unloadPlugin`/`importPlugin`/`restartWebhelper`).

`plugins/decky-qam-shortcut` is the reference for footer work: the installed plugin is named
**DeckyShortcut** (its `plugin.json` name) and adds `Ctrl+2 DECKY` to the bottom bar, left of
`F9 OPTIONS`. `plugins/scskiller` is the reference for in-page buttons: one 48×48 icon left of the
controller icon on a game page, with a stats modal and a Python backend reading the target app's own
JSON state. Their panels and READMEs are in French because they are French-facing deliverables; this
workshop documentation is in English.
