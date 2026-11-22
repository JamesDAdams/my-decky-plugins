(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const trees = (context && context.m_rgGamepadNavigationTrees) || [];
  const doc = (() => {
    let d = null;
    const seen = new Set();
    const walk = (node) => {
      if (!node || typeof node !== "object" || seen.has(node) || d) return;
      seen.add(node);
      const el = node.m_element;
      if (el && el.ownerDocument && el.ownerDocument !== document) d = el.ownerDocument;
      for (const child of node.m_rgChildren || []) walk(child);
    };
    for (const t of trees) walk(t && t.m_Root);
    return d;
  })();
  if (!doc) return JSON.stringify({ error: "no document" });
  const ours = doc.querySelector("[data-scskiller-button]");

  let ourNode = null;
  let playNode = null;
  let rowNode = null;
  const seen = new Set();
  const scan = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const el = node.m_element;
    if (el === ours) ourNode = node;
    if (el && el.nodeType === 1) {
      const text = String(el.textContent || "").trim();
      const cls = String(el.className || "");
      if (text === "Play" && /Play/.test(cls)) playNode = playNode || node;
      if (cls.indexOf("_1thLDT") >= 0) rowNode = node;
    }
    for (const child of node.m_rgChildren || []) scan(child);
  };
  for (const t of trees) scan(t && t.m_Root);

  const state = (label) => {
    const tree = context.m_LastActiveNavTree || trees[0];
    const node = tree && tree.m_lastFocusNode;
    const el = node && node.m_element;
    return {
      label,
      active: doc.activeElement ? String(doc.activeElement.className || "").slice(0, 30) : null,
      activeIsOurs: doc.activeElement === ours,
      treeFocus: el ? String(el.textContent || "").trim().slice(0, 16) || String(el.className || "").slice(0, 24) : null,
      treeFocusOurs: el === ours,
    };
  };

  const out = { found: { ours: !!ourNode, play: !!playNode, row: !!rowNode } };
  if (!ourNode) return JSON.stringify(out);
  out.oursNode = {
    depth: ourNode.m_nDepth,
    focusable: (() => {
      try {
        return String(ourNode.GetFocusable());
      } catch (e) {
        return "err";
      }
    })(),
    parent: ourNode.m_Parent ? String(ourNode.m_Parent.m_element && ourNode.m_Parent.m_element.className || "").slice(0, 34) : null,
    parentIsRow: ourNode.m_Parent === rowNode,
    siblings: (ourNode.m_Parent ? (ourNode.m_Parent.m_rgChildren || []).length : null),
  };
  out.states = [];
  try {
    context.BIsActive && out.contextActive;
    const tree = context.m_LastActiveNavTree || trees[0];
    tree.TakeFocus(ourNode);
    out.states.push(state("after TakeFocus(ours)"));
    if (playNode) {
      tree.TakeFocus(playNode);
      out.states.push(state("after TakeFocus(play)"));
    }
  } catch (e) {
    out.error = String(e.message);
  }
  return JSON.stringify(out, null, 1);
})()
