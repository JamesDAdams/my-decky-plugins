---
name: steam-footer-legend
description: >
  Add a button/legend to Steam Big Picture's bottom shortcut bar with the native look and the right
  position (e.g. immediately left of "F9 OPTIONS"). Use whenever a shortcut must be shown at the
  bottom of the screen, a key hint added, a clickable button placed in the Big Picture footer, or
  the look of Steam's own legends (F1 MENU, F9 OPTIONS, Enter SELECT…) reproduced.
---

# Native legend in the Big Picture bottom bar

Goal: an element that **looks exactly** like Steam's legends and sits **in the right spot** of the
row — with no hand-written CSS and no approximate `position: fixed`.

## Principle

1. The footer is rendered by React inside the visible `Steam Big Picture Mode` window.
2. Each legend is a `div` with **two children**: a key cap (`[role="img"]`, `aria-label="Esc Key"`,
   text inside `[aria-hidden] > div`) and a text label.
3. The row is `[left items…] [empty spacer] [right items…]`. The spacer is the child whose
   `textContent` is empty; it pushes the right cluster.
4. **Clone an existing item** (same classes → same rendering, same language, same states) and insert
   it **right after the spacer**: it then appears immediately left of `F9 OPTIONS` (or of
   `Enter SELECT` when `OPTIONS` is not shown).

Measured result for a 6-character item: `119×35 px` at `y=723`, versus `94×35 px` at `y=723` for the
native neighbour → same height, same baseline, same styling.

## Recipe (self-contained injected script)

```js
// 1. find a native item: the last key cap of the bottom bar
var template = null;
var imgs = document.querySelectorAll('[role="img"]');
for (var i = 0; i < imgs.length; i++) {
  var r = imgs[i].getBoundingClientRect();
  if (r.width < 6 || r.height < 6 || r.top < window.innerHeight * 0.8) continue;
  var node = imgs[i].parentElement;
  for (var d = 0; d < 5 && node; d++) {
    if (node.children.length === 2 && node.parentElement && node.parentElement.children.length >= 2) {
      template = node;
      break;
    }
    node = node.parentElement;
  }
}

// 2. clone + rename
var clone = template.cloneNode(true);
clone.id = "decky-qam-hint";
clone.setAttribute("role", "button");
clone.setAttribute("tabindex", "-1");
clone.setAttribute("aria-label", "Open the Decky panel (Ctrl+2)");
var cap = clone.querySelector('[role="img"]');
cap.setAttribute("aria-label", "Ctrl+2");
(cap.querySelector('[aria-hidden="true"] > div') || cap.querySelector("div")).textContent = "Ctrl+2";
clone.children[1].textContent = "DECKY";
clone.addEventListener("click", onClick);

// 3. insert after the spacer (i.e. left of F9 OPTIONS)
var row = template.parentElement;
var kids = Array.prototype.slice.call(row.children);
var spacer = -1;
for (var k = 0; k < kids.length; k++) {
  if ((kids[k].textContent || "").trim() === "") { spacer = k; break; }
}
row.insertBefore(clone, spacer >= 0 ? kids[spacer + 1] : kids[kids.length - 1]);
```

Execution context is mandatory: this script must **not** run in the plugin's `document` (the 1×1
`SharedJSContext` window). Inject it into the visible window:

```ts
await executeInTab("Steam Big Picture Mode", false, `(${install.toString()})(${JSON.stringify(cfg)})`);
```

## A click cannot call back into the plugin

A CEF window exports no object to the plugin context. The pattern that works (and ships in
`plugins/decky-qam-shortcut/src/bridge.ts`):

1. in the visible window the handler does
   `window.__DECKY_HINT_REQ__ = (window.__DECKY_HINT_REQ__|0)+1`;
2. the plugin reads that counter every ~700 ms with `executeInTab`;
3. when it increases, the plugin performs the action (here:
   `MenuStore.OpenQuickAccessMenu(999)`).

**Pitfall**: at startup, do not treat the counter's existing value as a click — prime
`lastRequest = currentCounter` on the first successful read.

## React rebuilds the bar

On every context change (navigation, keyboard↔controller switch) React renders the row again and the
cloned node can disappear. The plugin must therefore:

- check `document.getElementById("<id>")` on every poll (in the same read as the counter);
- re-insert when it is gone, remove it when the setting is disabled.

Never insert twice: `if (document.getElementById(id)) { update texts; return; }`.

## Pitfalls

- **No `position: fixed`.** The element must be a child of the row (flex), otherwise it floats above
  the bar and follows neither the bar nor its margins.
- **No copied CSS.** Any manual imitation (background, radius, font) drifts: clone instead.
- **Controller mode.** Steam replaces text key caps with SVG control glyphs; a keyboard clone would
  look wrong there. Remove the element in controller mode (and show nothing: the native QAM button
  already does the job).
- **Language.** Never search for "OPTIONS" by text (localised): position comes from the spacer and
  the target from `[role="img"]`.
- **CDP screenshot.** `Page.captureScreenshot` times out on this client: validate with geometry
  (`getBoundingClientRect`) and `getComputedStyle(el).display === "flex"`.
- **Decky reinstalls the plugin** when a zip is installed: the old element is removed by
  `onDismount` (plan the `executeInTab` destruction call).

## Verification (2 minutes)

```js
// in the visible window
var el = document.getElementById("decky-qam-hint");
JSON.stringify({
  text: el.textContent,                           // "Ctrl+2DECKY"
  rect: el.getBoundingClientRect(),               // height/top equal to the native legend
  display: getComputedStyle(el).display,          // "flex"
  order: [].map.call(el.parentElement.children, c => c.textContent),
});
```

Expected: `order` = `["F1Menu", "", "Ctrl+2DECKY", "F9Options", "EnterSelect", "EscBack"]`
(label contents depend on the language; the order does not).

Measured structure and the test set: `references/footer-dom-recipe.md`.
