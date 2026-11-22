(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const trees = (context && context.m_rgGamepadNavigationTrees) || [];
  const seen = new Set();
  let rowNode = null;
  let doc = null;
  const scan = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const el = node.m_element;
    if (el && !doc && el.ownerDocument && el.ownerDocument !== document) doc = el.ownerDocument;
    if (el && String(el.className || "").indexOf("_1thLDT") >= 0) rowNode = node;
    for (const child of node.m_rgChildren || []) scan(child);
  };
  for (const t of trees) scan(t && t.m_Root);
  if (!rowNode) return JSON.stringify({ error: "no row" });
  const bar = rowNode.m_Parent;
  const name = (node) => {
    const el = node && node.m_element;
    if (!el) return "null";
    const label = el.getAttribute && el.getAttribute("aria-label");
    const text = String(el.textContent || "").trim().slice(0, 14);
    return (label || text || String(el.className || "").slice(0, 22)) + " @" + Math.round((el.getBoundingClientRect() || { x: 0 }).x);
  };
  const out = {
    bar: name(bar),
    barChildren: (bar.m_rgChildren || []).map(name),
    rowChildren: (rowNode.m_rgChildren || []).map(name),
    dirTests: {},
  };
  for (let dir = 0; dir < 8; dir += 1) {
    const entry = {};
    for (const [who, node] of [
      ["bar", bar],
      ["row", rowNode],
    ]) {
      try {
        entry[who] = name(node.FindNextFocusableChild(dir));
      } catch (e) {
        entry[who] = "err " + String(e.message).slice(0, 30);
      }
    }
    out.dirTests[dir] = entry;
  }
  // what our own node looks like now
  const ours = doc.querySelector("[data-scskiller-button]");
  out.ours = (rowNode.m_rgChildren || []).map((n) => ({ label: name(n), isOurs: n.m_element === ours }));
  return JSON.stringify(out, null, 1);
})()
