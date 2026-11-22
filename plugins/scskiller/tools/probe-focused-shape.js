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
  const manage = (rowNode.m_rgChildren || []).find(
    (child) => child.m_element && child.m_element.getAttribute && child.m_element.getAttribute("aria-label") === "Manage",
  );

  const safe = (obj) => {
    if (obj === null || obj === undefined) return { kind: String(obj) };
    if (typeof obj !== "object") return { kind: typeof obj, value: String(obj) };
    const out = { kind: "object" };
    try {
      out.ctor = obj.constructor && obj.constructor.name;
    } catch (e) {
      out.ctor = "err";
    }
    const names = Object.getOwnPropertyNames(obj).slice(0, 6);
    out.own = names.map((name) => {
      const desc = Object.getOwnPropertyDescriptor(obj, name);
      if (!desc) return name + ":?";
      if (desc.get) return name + " [get]";
      return name + ":" + typeof desc.value + (typeof desc.value !== "object" ? "=" + String(desc.value).slice(0, 12) : "");
    });
    try {
      out.hasSet = typeof obj.Set === "function";
      out.hasGet = typeof obj.Get === "function";
    } catch (e) {
      out.hasSet = "err";
    }
    return out;
  };

  return JSON.stringify(
    {
      manage: { m_Focused: safe(manage.m_Focused), m_FocusWithin: safe(manage.m_FocusWithin) },
      ours: { m_Focused: safe(ourNode.m_Focused), m_FocusWithin: safe(ourNode.m_FocusWithin) },
      row: { m_Focused: safe(rowNode.m_Focused), m_FocusWithin: safe(rowNode.m_FocusWithin) },
      ourNodeKeys: Object.keys(ourNode).slice(0, 40),
    },
    null,
    1,
  );
})()
