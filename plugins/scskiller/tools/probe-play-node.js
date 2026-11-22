// Node tree around the game page's play button: what the controller walks before/after it, so an
// injected sibling can be adopted into the right group.
// Usage: node ../tools/cdp.mjs SharedJSContext probe-play-node.js
(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  if (!context) return "no active context";
  const seen = new Set();
  let hit = null;
  const label = (node) => {
    const el = node && node.m_element;
    if (!el) return "-";
    const text = String(el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 22);
    return text || "(" + String(el.className || "").slice(0, 18) + ")";
  };
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || seen.has(node) || hit || depth > 30) return;
    seen.add(node);
    const el = node.m_element;
    if (el && String(el.textContent || "").trim() === "Play") {
      const box = el.getBoundingClientRect();
      if (box.width > 120 && box.height > 30) {
        hit = node;
        return;
      }
    }
    for (const child of node.m_rgChildren || []) walk(child, depth + 1);
  };
  for (const tree of context.m_rgGamepadNavigationTrees || []) walk(tree.m_Root, 0);
  if (!hit) return "no play node";
  const chain = [];
  let node = hit;
  for (let up = 0; node && up < 5; up++) {
    const box = node.m_element ? node.m_element.getBoundingClientRect() : null;
    chain.push({
      label: label(node),
      focusable: node.GetFocusable ? node.GetFocusable() : "?",
      layout: node.GetLayout ? node.GetLayout() : "?",
      depth: node.m_nDepth,
      children: (node.m_rgChildren || []).length,
      rect: box ? [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)] : null,
    });
    node = node.m_Parent;
  }
  const siblings = (hit.m_Parent?.m_rgChildren || []).map((child) => ({
    label: label(child),
    focusable: child.GetFocusable ? child.GetFocusable() : "?",
  }));
  return JSON.stringify({ chain, siblings }, null, 1);
})()
