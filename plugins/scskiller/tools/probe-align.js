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
  const controller = doc.querySelector('[aria-label="Configure Controller"]');

  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const before = { ours: rect(ours), controller: rect(controller) };

  // scroll the app page like a controller user would (the details column scrolls)
  let scrolled = 0;
  const candidates = [ours.parentElement, ours.parentElement && ours.parentElement.parentElement];
  for (const node of candidates) {
    if (node && node.scrollHeight > node.clientHeight + 4) {
      node.scrollTop += 120;
      scrolled = 120;
      break;
    }
  }
  if (!scrolled) {
    // fall back to the page scroller: the nearest ancestor that actually scrolls
    let parent = ours.parentElement;
    while (parent && parent !== doc.body) {
      if (parent.scrollHeight > parent.clientHeight + 4) {
        parent.scrollTop += 120;
        scrolled = 120;
        break;
      }
      parent = parent.parentElement;
    }
  }
  const after = { ours: rect(ours), controller: rect(controller) };

  const children = (rowNode.m_rgChildren || []).map((child) => {
    const el = child.m_element;
    return {
      label: el && el.getAttribute && el.getAttribute("aria-label"),
      cls: el ? String(el.className || "").slice(0, 34) : null,
      focusable: (() => {
        try {
          return String(child.GetFocusable());
        } catch (e) {
          return "err";
        }
      })(),
      rect: el ? rect(el) : null,
      isOurs: el === ours,
    };
  });
  return JSON.stringify({ scrolled, before, after, children, oursNodeParentIsRow: !!(ours && rowNode.m_rgChildren.includes(rowNode.m_rgChildren.find((c) => c.m_element === ours))) }, null, 1);
})()
