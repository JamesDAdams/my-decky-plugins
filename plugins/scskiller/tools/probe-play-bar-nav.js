(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const trees = (context && context.m_rgGamepadNavigationTrees) || [];
  const seen = new Set();
  let rowNode = null;
  const walk = (node) => {
    if (!node || typeof node !== "object" || seen.has(node) || rowNode) return;
    seen.add(node);
    const el = node.m_element;
    if (el && el.nodeType === 1 && String(el.className || "").indexOf("_1thLDT") >= 0) rowNode = node;
    for (const child of node.m_rgChildren || []) walk(child);
  };
  for (const tree of trees) walk(tree && tree.m_Root);
  if (!rowNode) return JSON.stringify({ error: "no row" });

  const barNode = rowNode.m_Parent;
  const label = (node) => {
    const el = node && node.m_element;
    if (!el) return "null";
    return (
      (el.getAttribute && el.getAttribute("aria-label")) ||
      String(el.textContent || "").trim().slice(0, 18) ||
      String(el.className || "").slice(0, 26)
    );
  };
  const describe = (node) => ({
    name: label(node),
    focusable: (() => {
      try {
        return String(node.GetFocusable());
      } catch (e) {
        return "err";
      }
    })(),
    depth: node.m_nDepth,
    layout: (() => {
      try {
        return node.GetLayout();
      } catch (e) {
        return "err";
      }
    })(),
    props: node.m_Properties
      ? {
          childFocusDisabled: node.m_Properties.childFocusDisabled,
          focusable: node.m_Properties.focusable,
          fnCanTakeFocus: typeof node.m_Properties.fnCanTakeFocus,
          focusableIfEmpty: node.m_Properties.focusableIfEmpty,
          navKey: node.m_Properties.navKey,
        }
      : null,
    rect: (() => {
      const r = node.m_element && node.m_element.getBoundingClientRect();
      return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) } : null;
    })(),
  });

  const out = { bar: describe(barNode), row: describe(rowNode), barChildren: (barNode.m_rgChildren || []).map(describe) };
  // what the bar thinks it can reach, direction by direction
  const targ = {};
  for (let dir = 0; dir < 8; dir += 1) {
    try {
      targ[dir] = {
        has: barNode.BHasNavTargetInDirection(dir, false),
        next: label(barNode.FindNextFocusableChild(dir)),
      };
    } catch (e) {
      targ[dir] = "err " + e.message.slice(0, 40);
    }
  }
  out.barTargets = targ;
  return JSON.stringify(out, null, 1);
})()
