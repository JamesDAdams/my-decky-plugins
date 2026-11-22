// Where did the injected cancel button land, and where should it be?
// Usage: node ../tools/cdp.mjs "Steam Big Picture Mode" probe-cancel-parent.js
(() => {
  const cancel = document.querySelector("[data-scsk-cancel]");
  if (!cancel) return "no cancel element";
  const chain = [];
  let element = cancel;
  for (let depth = 0; element && depth < 5; depth++) {
    const box = element.getBoundingClientRect();
    chain.push({
      tag: element.tagName,
      cls: String(element.className || "").slice(0, 30),
      text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24),
      display: getComputedStyle(element).display,
      flexDirection: getComputedStyle(element).flexDirection,
      rect: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
      children: element.children.length,
    });
    element = element.parentElement;
  }
  const playLeaves = Array.from(document.querySelectorAll("div, span")).filter(
    (el) => el.children.length === 0 && /^(Play|Resume|Pause)$/.test((el.textContent || "").trim()),
  );
  const button = playLeaves
    .map((leaf) => leaf.closest("[tabindex], button"))
    .find((candidate) => {
      if (!candidate) return false;
      const box = candidate.getBoundingClientRect();
      return box.width > 120 && box.height > 30 && box.y > 200;
    });
  return JSON.stringify(
    {
      cancelStyle: cancel.getAttribute("style"),
      chain,
      button: button
        ? {
            rect: (() => {
              const box = button.getBoundingClientRect();
              return [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
            })(),
            parentChildren: Array.from(button.parentElement.children).length,
            grandParentChildren: button.parentElement.parentElement
              ? Array.from(button.parentElement.parentElement.children).length
              : null,
          }
        : null,
    },
    null,
    1,
  );
})()
