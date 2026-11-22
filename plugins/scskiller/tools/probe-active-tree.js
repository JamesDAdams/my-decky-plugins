// Which tree is the active one, what are its children in order, and what does the focus walk see?
(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  if (!context) return "no active context";
  const trees = Array.from(context.m_rgGamepadNavigationTrees || []);
  const active = context.m_LastActiveNavTree;
  const label = (node) => {
    const el = node && node.m_element;
    if (!el) return "-";
    return String(el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24) || "(" + String(el.className || "").slice(0, 18) + ")";
  };
  const describe = (tree, index) => {
    const root = tree.m_Root;
    const kids = (root?.m_rgChildren || []);
    return {
      index,
      isActive: tree === active,
      name: String(tree.m_Name ?? tree.m_strName ?? tree.constructor?.name ?? "?"),
      root: label(root),
      rootFocusable: root?.GetFocusable ? root.GetFocusable() : "?",
      rootLayout: root?.GetLayout ? root.GetLayout() : "?",
      rootChildren: kids.length,
      children: kids.map((child) => ({
        text: label(child),
        focusable: child.GetFocusable ? child.GetFocusable() : "?",
        depth: child.m_nDepth,
        children: (child.m_rgChildren || []).length,
        sorted: child.m_bChildrenSorted,
        y: child.m_element ? Math.round(child.m_element.getBoundingClientRect().y) : null,
      })),
    };
  };
  return JSON.stringify(trees.map(describe), null, 1);
})()
