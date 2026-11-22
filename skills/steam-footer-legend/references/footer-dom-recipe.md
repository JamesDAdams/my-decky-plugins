# Real Big Picture footer structure (measured)

Windows Steam client, Big Picture, viewport `1353×761`, November 2026.

## Row

```
div.<row>                                  ← 1307×41 at (23,720)
├── div.<item>            "F1 Menu"        ← 92×35  at (23,723)
├── div                   ""               ← spacer (flex), 978×0 at (139,741)
├── div.<item>            "Enter Select"   ← 94×35  at (1126,723)
└── div.<item>            "Esc Back"       ← 94×35  at (1236,723)
```

When the view exposes "Options", an `F9 OPTIONS` item is inserted at the head of the right cluster:

```
["F1Menu", "", "F9Options", "EnterSelect", "EscBack"]
```

## One item

```html
<div class="<item>">
  <div class="<capWrapper>">
    <div role="img" class="_1jGkuUHTcd0kTwEZrq3VYX _223Oc5oDpuWbmKuJQuEYi8" aria-label="Escape Key">
      <div class="K078lLw-1HGvDqnqRKnzG" aria-hidden="true">
        <div class="_69cJpzjXh7_ZFKUnWABhe">Esc</div>
      </div>
    </div>
  </div>
  <div class="_31JnnWnVv7U4VrSuta5yWO">Back</div>
</div>
```

Useful points:

- `role="img"` + `aria-label="… Key"` is a reliable anchor for key caps (language and hashed class
  independent);
- the key cap text is the terminal `div` under `[aria-hidden="true"]`;
- the label is the **second child** of the item;
- classes are hashed (`_69cJpzjXh7_ZFKUnWABhe`…): never hard-code them, clone the item.

## Style references

| Element | Measured value |
| --- | --- |
| "Esc" key cap | 36×25, `display:flex` inside the item |
| full item | 94×35 at `y=723` |
| cloned item (6 characters) | 119×35 at `y=723` |
| item `display` | `flex` |

Width follows content: a longer label widens the key cap without breaking alignment.

## Robust template lookup

```js
function findLegendItem() {
  var best = null;
  var imgs = document.querySelectorAll('[role="img"]');
  for (var i = 0; i < imgs.length; i++) {
    var r = imgs[i].getBoundingClientRect();
    if (r.width < 6 || r.height < 6 || r.top < window.innerHeight * 0.8) continue;
    var node = imgs[i].parentElement;
    for (var d = 0; d < 5 && node; d++) {
      if (node.children.length === 2 && node.parentElement && node.parentElement.children.length >= 2) {
        best = node;
        break;
      }
      node = node.parentElement;
    }
  }
  return best;
}
```

Why 5 levels: depending on the mode (keyboard/controller) and client version, the item sits 2 or 3
levels above `role="img"`. The "2 children, parent with ≥ 2 children" condition finds it in both
cases; the loop keeps the **last** match, i.e. the right cluster.

## Test set used to validate the plugin

| Test | Expected |
| --- | --- |
| insertion | `{"ok":true,"showing":true,"inserted":true}` |
| geometry | height and `top` equal to the native neighbour |
| order | the item is the child right after the spacer |
| click | counter `+1` |
| `Ctrl+2` | counter `+1` |
| after 5 s | still present (React did not remove it) |
| destroy | `document.getElementById(id) === null` |

## What does not work

- `position: fixed; bottom: 9px`: floats, does not follow the bar, wrong vertical alignment;
- copying styles by hand (background, radius, font): visibly different result;
- searching "OPTIONS" / "BACK" by text: depends on the client language;
- injecting into `SharedJSContext`: 1×1 window, nothing is visible;
- `Page.captureScreenshot` as a check: times out on this client.
