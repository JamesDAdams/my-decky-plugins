---
name: decky-gamepad-focus
description: >
  Make a control added by a Decky plugin reachable with a gamepad in Steam Big Picture, and prove it
  without a controller. Use whenever a plugin button "is there but the D-pad skips it", "right from
  Play does nothing", "the controller gets stuck on it", or when a native row stops being navigable
  after an injection. Covers navigation nodes, the focus stores Steam requires, cloned native icons,
  and the `pad-sim.mjs` simulator.
---

# Gamepad focus in Steam Big Picture

A control is reachable with the controller **only** if Steam's navigation tree contains a node for it,
and that node is well formed. Everything below was measured on Windows Steam + Decky 3 (2026-11);
each claim has its probe.

**Never say "not reachable" or "mouse only" before running the simulator** (`pad-sim.mjs`, §6). The
D-pad can be reproduced; guessing cost hours.

## 1. The model, in five lines

- Steam keeps **navigation trees**: `SteamUIStore.NavigationManager.m_ActiveContext.m_rgGamepadNavigationTrees`.
- A node holds `m_element` (its DOM element), `m_Parent`, `m_rgChildren`, `m_nDepth`, `m_Properties`.
- `node.GetFocusable()` returns `"self"`, `"children"` or `"none"`; **`"none"` means the traversal
  skips it** (and a `"none"` child can kill the whole group, see §3).
- The focus state lives in two subscribables, `m_Focused` and `m_FocusWithin`; Steam calls
  `node.m_Focused.Set(...)` while moving. Booleans there break everything.
- The node's tree is found through the plugin context (`SharedJSContext`, the 1×1 window); the DOM it
  points at belongs to the visible `Steam Big Picture Mode` window.

## 2. Every surface, one rule

Whatever the plugin draws, the same three questions decide whether a controller can use it:

1. **Is the control a `Focusable`** (or a clone carrying an adopted node)? A plain `<button>`, a `div`
   with `onClick`, a `<span role="button">`: DOM-focusable at best, **not a navigation node** — the pad
   never lands on it.
2. **Is its parent group laid out correctly?** Steam reads the parent's `GetLayout()`: a row of
   buttons inside a vertical container only moves up/down. Wrap each row in a `Focusable` with an
   explicit `flexDirection` (`row` for a footer/tab strip, `column` for a list).
3. **Can you see the focus?** `noFocusRing` + a custom style = invisible selection. Either drop
   `noFocusRing` or paint `:focus` yourself (`background:#e6e8ea; color:#16191d`). For a cloned
   native element that means `addEventListener('focus'/'blur')` in the injected script: a clone has
   no React state, so Steam has nothing to paint (measured on the account page button: reachable, but
   white-on-grey just like unfocused, so the user reported "I cannot go on it").

4. **Can the controller activate it?** A `Focusable` fires `onActivate` on A. A DOM clone fires
   nothing: wire `vgp_onok` yourself (and keep the mouse click).

Surface by surface:

| Surface | What to do | What goes wrong otherwise |
| --- | --- | --- |
| Game page row (48×48 icon) | clone a native icon of the row, `adopt()` its node, `vgp_onok` listener, `:focus` painting, `fill` forced dark (§4) | node under the page container; invisible glyph on white |
| Full-page route (`routerHook.addRoute`) | build the page out of `Focusable`s; give the page at least one control, and `autoFocus` the first one | nothing focusable → the pad does nothing (only B works) |
| QAM panel (`content:`) | `Focusable` per control, `autoFocus` on the tab or the first button: **measured**, after selecting the plugin entry the panel opened with `m_lastFocusNode = null` until a control carried `autoFocus` | focus lost on open, the panel feels dead |
| QAM list rows (one line + one button) | wrap **each row** in a horizontal `Focusable` (nested `Focusable`s are fine, contrary to an older note: measured node `GetFocusable() = "children"`, `GetLayout() = 2`, children = `[label, button]`); Up/Down then walks the rows, Right enters the row | flattened siblings: measured 40 children under one vertical container, so Down went label → button → next label (reported as "down should change game, right should reach Compile") |
| Modal dialog (`showModal`) | footer = horizontal `Focusable`, one `Focusable` per button, `:focus` painted (§7) | only up/down moves, selection invisible |
| Injected DOM (icon row of another window, top bar, overlay, account button) | the injected code has no `SteamUIStore`: the plugin context must adopt the node from a native neighbour **and** the injected code must paint its own focus + answer `vgp_onok` (measured: the account-page clone was reachable but looked identical focused, and A did nothing, because a clone has neither React state nor a Focusable handler) | mouse-only control, or a control that works and looks dead |
| Left rail entry (DOM clone in `MainMenu_uid*`) | `adopt()` the **`[role="menuitem"]` inside** the injected clone (that is the element Steam focuses, not the wrapper), paint its focus, answer `vgp_onok`; measured focused look: `background rgba(255,255,255,0.2)`, white label and glyph, `10px` `#1a9fff` bar as first child | focus lands on a row that has no handler: grey, and A silent |

## 3. Why a plugin control usually is not reachable

| Cause | Symptom | Fix |
| --- | --- | --- |
| The element is drawn by a route patch overlay and registered under the **page container** | `nav-audit.mjs` shows parent `_1Svpj…` instead of the target row | put the control in a React child of the row (hard) **or** clone a native element of the row and adopt its node (below) |
| The element is **not a DOM descendant** of the parent node's element | node is in `m_rgChildren`, `self`, but the pad never lands on it | the element must live inside the row (a `position: fixed` layer outside the row is skipped) |
| The copied node kept `fnCanTakeFocus` / `childFocusDisabled` | `GetFocusable() = "none"` | `delete` both, force `focusable: true` |
| The copied node has **booleans** in `m_Focused` / `m_FocusWithin` | `node.BTakeFocus` throws `this.m_Focused.Set is not a function`; the **whole group** becomes unreachable | `makeFocusState()`: `new templateStore.constructor(false)` |
| The node list order does not match the DOM | traversal enters the row in the wrong order | `unshift` the node in `m_rgChildren`, then `EnsureChildrenSorted()` |
| The cloned element does not answer the controller | Steam activates the focused element by dispatching **`vgp_onok`** on it (it is the listener every native `Focusable` registers); a cloned DOM element has none, so A does nothing while the mouse click works | add `button.addEventListener("vgp_onok", open)` (and `vgp_onsecondaryaction`) next to the click handler |
| The focused glyph vanishes on a white box | the native class colours the **`svg`** white with a stronger selector than the button's `color`, so `:focus{background:white}` gives a white glyph on white (measured: computed `fill: rgb(255,255,255)` while focused) | force it: `[data-x]:focus svg, [data-x]:focus svg path { color:#16191d!important; fill:#16191d!important }` |
| A node of the group points at a **detached** element (the clone was rebuilt after a Steam re-render) | the whole group stops moving: measured, six `down` presses left the focus on `Home`; the node still answers `GetFocusable() = "self"` with a `0,0` rect | before re-adopting, prune the group's children whose `m_element.isConnected === false`, then insert the new node at the DOM position and `EnsureChildrenSorted()` |
| The cloned wrapper is not the element Steam focuses | the clone looks right but the node points at the inner `[role="menuitem"]`: focus lands, the row stays grey, A does nothing | put aria/listeners/painting on the inner menuitem (`clone.querySelector('[role="menuitem"]')`), keep `data-*` on the wrapper for lookups |
| Steam's **screensaver** is running (`Screensaver_uid2` target) | every press does nothing, the focus never moves, and a desktop capture is black | it is not your code: `node tools/kill-screensaver.mjs` closes that target (CDP `Page.close`). An OS Shift or click does **not** reliably dismiss it, and it returns after a couple of idle minutes: re-check the target list before every walk |

`adopt()` in `plugins/scskiller/src/navAdopt.ts` (and the `steamswitch` copy) implements all of this.
Use it; do not hand-roll a node.

## 4. The one mistake that breaks everything

Writing a plain `false` into `m_Focused` / `m_FocusWithin`:

```js
node.BTakeFocus(other)   // TypeError: this.m_Focused.Set is not a function
```

An exception thrown inside the traversal aborts it **silently**, so the user sees "the pad does
nothing" on *every* control of the row, not just on the new one. If a whole row stops being navigable
after a plugin injection, look for a malformed node first, not for React.

## 4. Recipe: a 48×48 icon in the play bar's icon row

1. Find the row from the plugin context: `uiDocument()` (from `navAdopt`) →
   `doc.querySelector('[aria-label="Configure Controller"]')` → `parentElement.parentElement`.
2. Clone a native icon **of that row** (`[aria-label="Manage"]`, or the last child) — same classes,
   same 48×48 box, no React handlers. Replace its glyph with yours, keep a `data-<plugin>` attribute.
3. Insert it as the row's **first child** (`row.insertBefore(button, row.firstChild)`).
4. `const node = adopt(button, nodeFor(row), nodeFor(nativeIcon))`, then move it to index 0 of
   `m_rgChildren` and call `rowNode.EnsureChildrenSorted()`.
5. Keep it alive with a 400 ms keeper: re-insert the element if Steam's re-render dropped it, and
   re-`adopt` only when `nodeFor(button)` is empty (never re-create the element: a new element needs a
   new node and loses the focus).
6. Add a `:focus` style: Steam paints its icons from React state, which a clone does not have.

Measured result: button at `x=1151`, controller icon at `1209`, settings at `1267`; after
`scrollTop += 120` both move `y=367 → 247` (the button scrolls with the row, proof it is inside it).

## 5. Probes (all in `plugins/scskiller/tools/`)

```powershell
node tools/nav-audit.mjs --text <label>        # navigable elements + their focus parent
node tools/nav-audit.mjs --near 1148,366       # same, around a point
node tools/probe-icon.js  <  tools/cdp.mjs     # row geometry + fiber chain of the controller icon
node tools/probe-row-node.js                   # the row's node: children, focus states, layout
```

Reading a node interactively (from `SharedJSContext`):

```js
const m = window.SteamUIStore.NavigationManager;
const c = m.m_ActiveContext;
const tree = c.m_LastActiveNavTree || c.m_rgGamepadNavigationTrees[0];
tree.m_lastFocusNode.m_element              // the focused DOM element
node.GetFocusable()                         // "self" | "children" | "none"
Object.keys(node.m_Properties)              // focusable, fnCanTakeFocus, childFocusDisabled, ...
```

## 6. The simulator: prove the walk yourself

Three things must be true before a press can move anything — check them in this order, it saves hours:

```powershell
node tools/kill-screensaver.mjs              # 1. no Screensaver_uid2 target (it swallows every press)
powershell -File tools/focus-bp.ps1          # 2. Steam Big Picture Mode is the foreground window
node tools/cdp.mjs SharedJSContext tools/open-main-menu.js   # 3. the surface you walk is the OPEN one
```

`MenuStore.GetOpenSideMenu()` answers `0` (none), `1` (main menu) or `2` (quick access). `OpenMainMenu()`
does **nothing** while the QAM is open: the QAM keeps the active focus tree, the rail nodes stay
inactive, `TakeFocus` silently fails and every press is a no-op (measured 2026-11-22). Always close
first, then open.

```powershell
node tools/pad-sim.mjs                                   # where is the focus?
node tools/pad-sim.mjs --from Play right right right left left left
node tools/pad-sim.mjs --walk right right                 # one line per press
```

It calls `NavigationManager.DispatchVirtualGamepad("vgp_onbuttondown"|"vgp_onbuttonup", {button,
source: 1, is_repeat})` (buttons: `INVALID=0`, `OK=1` = A, `CANCEL=2` = B, `SECONDARY=3`, `DIR_UP=9`,
`DIR_DOWN=10`, `DIR_LEFT=11`, `DIR_RIGHT=12`;
`source: 1` = GAMEPAD) and reads `tree.m_lastFocusNode` after each press. To start from a known place,
`tree.TakeFocus(node)` (it works only when the tree is the active focus tree).

Verified walk on a game page after the fix:

```
from Play: Play @38,367
  right -> [SCSKILLER] SCSKiller @1151,367
  right -> Configure Controller @1209,367
  right -> Manage @1267,367
  left  -> Configure Controller @1209,367
  left  -> [SCSKILLER] SCSKiller @1151,367
  left  -> Play @38,367
```

If presses do nothing: check `manager.GetEventTarget(12, 1, true)` returns `[element, tree]`,
`tree.BIsGamepadInputSuppressed()` is false, and the focused node is well formed (§3).

Two more verified walks (SCSKiller 0.9.11, 2026-11-22):

```
# QAM Games tab: one row per press, Right reaches that row's button
from Games: Games @54,70
  down  -> Setup @111,70
  down  -> Refresh @56,133
  down  -> Dead by Daylight @90,211
  right -> Compile @258,210
  left  -> Dead by Daylight @90,211
  down  -> Escape the Backrooms @90,247     (the next game, not the previous Compile)

# left rail: the injected entry is reachable and A opens the page
from Home: Home @-3,163
  down x5 -> Downloads @-3,403
  down    -> SCSKiller @0,453               (painted: white label, blue bar)
  ok      -> route /routes/scskiller, side menu closed
```

## 7. Inside a modal dialog (`showModal`, Steam dialog)

A Steam dialog is its own navigation tree (`ModalDialogOverlay_Modal_<n>`) and it becomes the active
focus tree, so its buttons are reachable by construction — but the dialog's content container is
**vertical** (measured: `GetLayout() = 1`, `flexDirection: column`). A plain `div` footer is not a nav
node, so the buttons become direct children of that vertical container: only up/down move between
them, left/right does nothing, and the user reports "the pad cannot select the buttons".

Wrap the footer in a horizontal `Focusable`:

```tsx
<Focusable noFocusRing style={{ display: "flex", flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
  {...buttons, each its own Focusable with onActivate...}
</Focusable>
```

Measured after the change: `Refresh -> right: Warmed -> right: Close -> A: dialog closed, focus back on
the page`. `GetLayout()` of the group then reports the horizontal value (the play bar's icon row, also
horizontal, reports `2`).

**And paint the focused button.** A `Focusable` with `noFocusRing` and a custom `style` looks exactly
the same focused and unfocused: the pad does move (the focus log proves it), but the user reports "the
pad cannot select the buttons". Give the buttons a class and a rule:

```css
.scsk-mbtn:focus { background:#e6e8ea !important; color:#16191d !important; outline:none }
```

That is the difference between "it works" and "it works and you can see it".

## 8. Verifying without a controller, honestly

| Question | How to answer |
| --- | --- |
| Is the node in the tree? | `nav-audit.mjs` lists it, with its parent |
| Will the traversal consider it? | `node.GetFocusable()` must not be `"none"`; every sibling too |
| Can the focus land on it? | `tree.TakeFocus(node)` then read `tree.m_lastFocusNode` and `doc.activeElement` |
| Can the user reach it from where they are? | run the walk (§6) from that place |
| Does it look right and stay put? | `getBoundingClientRect()` of your element vs the native one, before and after a `scrollTop += 120` |

A screenshot is not a proof of reachability; a walk is.

## 9. Definition of done (every surface, every time)

A surface is done when all of these are true — not when it compiles, and not when it looks right:

- [ ] every control is a `Focusable` (or a clone with an adopted node); no `<button>`/`<div onClick>` left
- [ ] each row/column of controls sits in a `Focusable` group with an explicit `flexDirection`
- [ ] the focused state is visible (own `:focus` style, glyph colour forced) — check it on a screenshot
- [ ] on a surface that opens (QAM tab, page, dialog): something takes the focus, `autoFocus` if needed
- [ ] `vgp_onok` wired for anything that is not a real `Focusable`
- [ ] the walk has been replayed with `pad-sim.mjs` on **that** surface, including one `ok` on each
      action, and the output is pasted in the commit/summary
- [ ] a list gives one press per row (Up/Down) and reaches the row's button with Right/Left
- [ ] the left-rail entry is walked **and activated** (`ok` changes the route), not just focused
- [ ] the log shows `focus: ...` lines for the surface during the walk
- [ ] anything still mouse-only is written down (file + line) instead of being quietly shipped

## 10. Checklist before shipping a control

- [ ] element inside the native row (not a fixed overlay outside it)
- [ ] node adopted from a sibling of the same row, `GetFocusable()` ≠ `none`, focus stores are objects
- [ ] node placed at the DOM index, then `EnsureChildrenSorted()` — **except** in the left rail, where
      re-sorting by hand froze every direction: there, let `adopt()` append the node and let Steam
      resolve the order from the geometry (measured 2026-11-22)
- [ ] keeper restores element and node after a Steam re-render
- [ ] `:focus` style painted by the plugin, with the glyph forced dark (the native class paints the
      svg white - a plain `color` change leaves a white glyph on the white focused background)
- [ ] `vgp_onok` listener wired: A must run the action, the mouse click alone is not enough
- [ ] inside a dialog: the button row is a horizontal `Focusable`, and the walk
      `<first button> right right -> A` has been replayed there too
- [ ] walk replayed with `pad-sim.mjs` and pasted in the log/commit message
- [ ] `AGENTS.md` §3c/§3d updated with any new measured fact
