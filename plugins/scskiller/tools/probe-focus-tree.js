// Dump the navigation tree around the current focus: parent chain, siblings, GetFocusable, layout
// and each child's element text. Usage: node ../tools/cdp.mjs SharedJSContext probe-focus-tree.js
(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  if (!context) return "no active context (window not focused?)";
  const tree = context.m_LastActiveNavTree || (context.m_rgGamepadNavigationTrees || [])[0];
  const node = tree && tree.m_lastFocusNode;
  if (!node) return "no focus";
  const label = (n) => {
    const el = n && n.m_element;
    if (!el) return "-";
    const text = String(el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24);
    return text || String(el.className || "").slice(0, 20);
  };
  const layoutOf = (n) => {
    try {
      return n.GetLayout ? n.GetLayout() : "?";
    } catch (error) {
      return "err";
    }
  };
  const describe = (n, depth) => {
    if (!n || depth > 4) return [];
    const lines = [
      "  ".repeat(depth) +
        `${label(n)} focusable=${n.GetFocusable ? n.GetFocusable() : "?"} layout=${layoutOf(n)} children=${(n.m_rgChildren || []).length}`,
    ];
    for (const child of n.m_rgChildren || []) lines.push(...describe(child, depth + 1));
    return lines;
  };
  let parent = node;
  const chain = [];
  for (let i = 0; i < 5 && parent; i++) {
    chain.push(`level -${i}: ${label(parent)} focusable=${parent.GetFocusable ? parent.GetFocusable() : "?"} layout=${layoutOf(parent)} children=${(parent.m_rgChildren || []).length}`);
    parent = parent.m_Parent;
  }
  return JSON.stringify(
    {
      chain,
      focusDepth: node.m_nDepth,
      focusBox: (() => {
        const box = node.m_element ? node.m_element.getBoundingClientRect() : null;
        return box ? [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)] : null;
      })(),
      siblings: (node.m_Parent?.m_rgChildren || []).map((child) => ({
        text: label(child),
        focusable: child.GetFocusable ? child.GetFocusable() : "?",
        depth: child.m_nDepth,
        layout: layoutOf(child),
        children: (child.m_rgChildren || []).length,
      })),
      treeFromGrandParent: describe(node.m_Parent?.m_Parent, 0),
    },
    null,
    1,
  );
})()
