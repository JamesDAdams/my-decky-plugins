(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const trees = (context && context.m_rgGamepadNavigationTrees) || [];
  const seen = new Set();
  let refresh = null;
  const walk = (node) => {
    if (!node || typeof node !== "object" || seen.has(node) || refresh) return;
    seen.add(node);
    const el = node.m_element;
    if (el && String(el.textContent || "").trim() === "Refresh") refresh = node;
    for (const child of node.m_rgChildren || []) walk(child);
  };
  for (const tree of trees) walk(tree && tree.m_Root);
  if (!refresh) return JSON.stringify({ error: "no Refresh node" });
  const describe = (node, depth) => {
    if (!node || depth > 4) return null;
    const el = node.m_element;
    return {
      cls: el ? String(el.className || "").slice(0, 30) : null,
      display: el ? el.ownerDocument.defaultView.getComputedStyle(el).display : null,
      flexDirection: el ? el.ownerDocument.defaultView.getComputedStyle(el).flexDirection : null,
      layout: (() => {
        try {
          return node.GetLayout();
        } catch (e) {
          return "err";
        }
      })(),
      focusable: (() => {
        try {
          return String(node.GetFocusable());
        } catch (e) {
          return "err";
        }
      })(),
      children: (node.m_rgChildren || []).length,
      parent: node.m_Parent ? describe(node.m_Parent, depth + 1) : null,
    };
  };
  return JSON.stringify(describe(refresh, 0), null, 1);
})()
