// What Steam paints on the game page's play button when the gamepad focuses it, and how the play
// bar row is laid out (the element tree the controller walks).
// Usage: node ../tools/cdp.mjs "Steam Big Picture Mode" probe-play-focus.js
(() => {
  const leaves = Array.from(document.querySelectorAll("div, span")).filter(
    (el) => el.children.length === 0 && /^(Play|Resume|Stop)$/.test((el.textContent || "").trim()),
  );
  const button = (() => {
    for (const leaf of leaves) {
      const candidate = leaf.closest("[tabindex], button");
      if (!candidate) continue;
      const box = candidate.getBoundingClientRect();
      if (box.width > 120 && box.height > 30 && box.y > 200) return candidate;
    }
    return null;
  })();
  if (!button) return "no play button";
  const describe = (element, label) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      label,
      cls: String(element.className || "").slice(0, 40),
      rect: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
      background: style.backgroundColor,
      color: style.color,
      inline: element.getAttribute("style"),
      focused: document.activeElement === element,
    };
  };
  const row = button.parentElement;
  return JSON.stringify(
    {
      active: document.activeElement === button,
      button: describe(button, "play button"),
      children: Array.from(button.children).map((child, index) => describe(child, "child " + index)),
      row: row
        ? {
            ...describe(row, "row"),
            kids: Array.from(row.children).map((child, index) => describe(child, "row child " + index)),
          }
        : null,
      scsk: {
        play: document.querySelector("[data-scsk-play]")?.getBoundingClientRect().toJSON?.() ?? null,
        cancel: document.querySelector("[data-scsk-cancel]")?.getBoundingClientRect().toJSON?.() ?? null,
        info: !!document.querySelector("[data-scsk-play-info]"),
      },
    },
    null,
    1,
  );
})()
