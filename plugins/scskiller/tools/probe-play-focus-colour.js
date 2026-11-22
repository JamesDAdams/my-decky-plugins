// Read the colour Steam paints on the play button when it is focused, with our inline override
// removed, then restore it. The plugin paints rgba(220,222,223,0.17) inline, which hides the
// focused state (that is why the pad's selection is invisible on that button).
// Usage: node ../tools/cdp.mjs "Steam Big Picture Mode" probe-play-focus-colour.js
(() => {
  const leaves = Array.from(document.querySelectorAll("div, span")).filter(
    (el) => el.children.length === 0 && /^(Play|Resume|Stop)$/.test((el.textContent || "").trim()),
  );
  let button = null;
  for (const leaf of leaves) {
    const candidate = leaf.closest("[tabindex], button");
    if (!candidate) continue;
    const box = candidate.getBoundingClientRect();
    if (box.width > 120 && box.height > 30 && box.y > 200) {
      button = candidate;
      break;
    }
  }
  if (!button) return "no play button";
  const focused = document.activeElement === button;
  const inline = button.getAttribute("style");
  const before = getComputedStyle(button).backgroundColor;
  button.style.backgroundColor = "";
  const withoutInline = getComputedStyle(button).backgroundColor;
  const children = Array.from(button.children).map((child) => ({
    visibility: child.style.visibility,
    background: getComputedStyle(child).backgroundColor,
  }));
  const hiddenSvg = Array.from(button.querySelectorAll("svg")).map((node) => node.style.visibility);
  if (inline) button.setAttribute("style", inline);
  return JSON.stringify(
    {
      focused,
      inline,
      before,
      withoutInline,
      children,
      hiddenSvg,
      activeTag: document.activeElement.tagName,
      activeLabel: (document.activeElement.textContent || "").trim().slice(0, 20),
    },
    null,
    1,
  );
})()
