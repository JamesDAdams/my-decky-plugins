(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const trees = (context && context.m_rgGamepadNavigationTrees) || [];
  let rowNode = null;
  let tree = null;
  const seen = new Set();
  const walk = (node, t) => {
    if (!node || typeof node !== "object" || seen.has(node) || rowNode) return;
    seen.add(node);
    const el = node.m_element;
    if (el && el.nodeType === 1 && String(el.className || "").indexOf("_1thLDT") >= 0) {
      rowNode = node;
      tree = t;
    }
    for (const child of node.m_rgChildren || []) walk(child, t);
  };
  for (const t of trees) walk(t && t.m_Root, t);

  if (!rowNode) return JSON.stringify({ found: false, trees: trees.length });

  const describe = (node) => {
    const el = node.m_element;
    let focusable = null;
    try {
      focusable = node.GetFocusable ? node.GetFocusable() : null;
    } catch (e) {
      focusable = "err";
    }
    const box = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    return {
      cls: el ? String(el.className || "").slice(0, 50) : null,
      label: el && el.getAttribute ? el.getAttribute("aria-label") : null,
      text: el ? String(el.textContent || "").trim().slice(0, 20) : null,
      focusable: String(focusable),
      depth: node.m_nDepth,
      children: (node.m_rgChildren || []).length,
      rect: box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null,
      props: node.m_Properties ? Object.keys(node.m_Properties) : null,
      navHandlers: (node.m_rgNavigationHandlers || []).length,
      focusHandlers: (node.m_rgFocusHandlers || []).length,
      sortedFlag: node.m_bChildrenSorted,
    };
  };

  const out = {
    found: true,
    treeId: tree && tree.m_ID,
    treeKeys: tree ? Object.keys(tree).slice(0, 20) : null,
    row: describe(rowNode),
    rowProto: Object.getPrototypeOf(rowNode) && Object.getPrototypeOf(rowNode).constructor && Object.getPrototypeOf(rowNode).constructor.name,
    children: (rowNode.m_rgChildren || []).map(describe),
    parent: rowNode.m_Parent ? describe(rowNode.m_Parent) : null,
  };
  return JSON.stringify(out, null, 1);
})()
