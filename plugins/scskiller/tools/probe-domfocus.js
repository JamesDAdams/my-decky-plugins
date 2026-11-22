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
  const ours = doc.querySelector("[data-scskiller-button]");
  const node = (rowNode.m_rgChildren || []).find((child) => child.m_element === ours);
  if (!node) return JSON.stringify({ error: "no node" });
  const tree = context.m_LastActiveNavTree || trees[0];
  const focusName = () => {
    const current = tree.m_lastFocusNode;
    const el = current && current.m_element;
    if (!el) return "none";
    return (el.getAttribute && el.getAttribute("aria-label")) || String(el.textContent || "").trim().slice(0, 16) || String(el.className || "").slice(0, 20);
  };
  const out = { before: focusName(), activeBefore: String(doc.activeElement && doc.activeElement.className || "").slice(0, 26) };

  // 1. plain DOM focus on the clone
  try {
    ours.focus({ preventScroll: true });
  } catch (e) {
    out.focusError = String(e.message);
  }
  out.afterFocus = {
    activeIsOurs: doc.activeElement === ours,
    navFocus: focusName(),
    nodeFocused: !!node.m_Focused,
    rowActiveChild: rowNode.m_ActiveChild ? String(rowNode.m_ActiveChild.m_element && rowNode.m_ActiveChild.m_element.getAttribute && rowNode.m_ActiveChild.m_element.getAttribute("aria-label")) : null,
  };

  // 2. does the navigation move on from here? ask the node list of the row what it would pick
  try {
    out.btakeFocusFromRow = typeof rowNode.BTakeFocus === "function" ? rowNode.BTakeFocus(node) : "?";
  } catch (e) {
    out.btakeFocusFromRow = "err " + e.message;
  }
  return JSON.stringify(out, null, 1);
})()
