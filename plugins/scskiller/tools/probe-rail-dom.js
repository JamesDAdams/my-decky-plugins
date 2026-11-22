// Dump the DOM of the rail around y=453 (our SCSKiller entry) next to the native Downloads one.
// Usage: node ../tools/cdp.mjs SharedJSContext probe-rail-dom.js
(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const trees = context ? Array.from(context.m_rgGamepadNavigationTrees || []) : [];
  const found = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || seen.has(node) || depth > 30) return;
    seen.add(node);
    const el = node.m_element;
    if (el) {
      const box = el.getBoundingClientRect();
      if (Math.round(box.y) === 453 || Math.round(box.y) === 403) found.push(el);
    }
    for (const child of node.m_rgChildren || []) walk(child, depth + 1);
  };
  for (const tree of trees) walk(tree && tree.m_Root, 0);

  const describe = (el) => {
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return {
      html: el.outerHTML.slice(0, 700),
      rect: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
      reactKeys: Object.keys(el).filter((key) => key.startsWith("__react")).map((key) => key.slice(0, 18)),
      parentClass: String(el.parentElement?.className || "").slice(0, 60),
      siblings: el.parentElement ? Array.from(el.parentElement.children).map((child) => ({
        text: String(child.textContent || "").trim().slice(0, 16),
        aria: child.getAttribute("aria-label"),
        className: String(child.className || "").slice(0, 40),
        react: Object.keys(child).some((key) => key.startsWith("__reactFiber")),
      })) : [],
    };
  };
  return JSON.stringify(found.map(describe), null, 1);
})()
