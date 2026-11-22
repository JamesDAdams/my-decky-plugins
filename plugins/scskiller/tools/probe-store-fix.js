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
  const ourNode = (rowNode.m_rgChildren || []).find((child) => child.m_element === ours);
  if (!ourNode) return JSON.stringify({ error: "no node" });
  const manage = (rowNode.m_rgChildren || []).find(
    (child) => child.m_element && child.m_element.getAttribute && child.m_element.getAttribute("aria-label") === "Manage",
  );
  const tree = context.m_LastActiveNavTree || trees[0];

  const makeStore = (templateStore) => {
    if (!templateStore || typeof templateStore !== "object") return templateStore;
    try {
      const ctor = Object.getPrototypeOf(templateStore).constructor;
      const fresh = new ctor(false);
      if (fresh && typeof fresh.Set === "function") return fresh;
    } catch (e) {
      // fall through
    }
    const copy = Object.create(Object.getPrototypeOf(templateStore));
    copy.m_callbacks = { m_vecCallbacks: [] };
    copy.m_currentValue = false;
    copy.m_fnEquals = undefined;
    return copy;
  };

  const out = { beforeFocus: null, afterTakeFocus: null };
  const focusName = () => {
    const node = tree.m_lastFocusNode;
    const el = node && node.m_element;
    if (!el) return "none";
    return (el.getAttribute && el.getAttribute("aria-label")) || String(el.textContent || "").trim().slice(0, 14) || String(el.className || "").slice(0, 18);
  };
  out.beforeFocus = focusName();
  out.typesBefore = { focused: typeof ourNode.m_Focused, within: typeof ourNode.m_FocusWithin };

  ourNode.m_Focused = makeStore(manage.m_Focused);
  ourNode.m_FocusWithin = makeStore(manage.m_FocusWithin);
  out.typesAfter = {
    focusedCtor: ourNode.m_Focused && ourNode.m_Focused.constructor && ourNode.m_Focused.constructor.name,
    hasSet: typeof (ourNode.m_Focused && ourNode.m_Focused.Set),
  };

  try {
    rowNode.BTakeFocus(ourNode);
    out.bTakeFocus = "ok";
  } catch (e) {
    out.bTakeFocus = "err " + e.message;
  }
  try {
    tree.TakeFocus(ourNode);
    out.takeFocus = "ok";
  } catch (e) {
    out.takeFocus = "err " + e.message;
  }
  out.afterTakeFocus = {
    focus: focusName(),
    domIsOurs: doc.activeElement === ours,
    nodeFocused: !!(ourNode.m_Focused && ourNode.m_Focused.m_currentValue),
  };
  return JSON.stringify(out, null, 1);
})()
