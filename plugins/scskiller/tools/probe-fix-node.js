(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const trees = (context && context.m_rgGamepadNavigationTrees) || [];
  let doc = null;
  let ourNode = null;
  let rowNode = null;
  const seen = new Set();
  const scan = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const el = node.m_element;
    if (el && !doc && el.ownerDocument && el.ownerDocument !== document) doc = el.ownerDocument;
    if (el && String(el.className || "").indexOf("_1thLDT") >= 0) rowNode = node;
    for (const child of node.m_rgChildren || []) scan(child);
  };
  for (const t of trees) scan(t && t.m_Root);
  if (!doc || !rowNode) return JSON.stringify({ error: "no row" });
  const ours = doc.querySelector("[data-scskiller-button]");
  for (const child of rowNode.m_rgChildren || []) if (child.m_element === ours) ourNode = child;
  if (!ourNode) return JSON.stringify({ error: "no node" });

  const out = { before: { props: Object.keys(ourNode.m_Properties || {}).slice(0, 12), focusable: String(ourNode.GetFocusable()) } };

  // the copy inherits the template's own "can I take focus" test, which answers for the Play button,
  // not for ours: replace it with a plain focusable node
  const props = Object.assign({}, ourNode.m_Properties || {});
  delete props.fnCanTakeFocus;
  delete props.childFocusDisabled;
  props.focusable = true;
  ourNode.m_Properties = props;
  out.after = { focusable: String(ourNode.GetFocusable()), keys: Object.keys(props).slice(0, 12) };

  const tree = context.m_LastActiveNavTree || trees[0];
  try {
    tree.TakeFocus(ourNode);
  } catch (e) {
    out.takeFocusError = String(e.message);
  }
  const focused = tree.m_lastFocusNode;
  out.focus = {
    isOurs: focused && focused.m_element === ours,
    activeIsOurs: doc.activeElement === ours,
    activeTag: doc.activeElement ? String(doc.activeElement.className || "").slice(0, 34) : null,
  };
  return JSON.stringify(out, null, 1);
})()
