(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const trees = (context && context.m_rgGamepadNavigationTrees) || [];
  const out = { rail: null, gameButton: null };
  const seen = new Set();
  let doc = null;
  const walk = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const el = node.m_element;
    if (el && el.nodeType === 1) {
      if (!doc && el.ownerDocument && el.ownerDocument !== document) doc = el.ownerDocument;
      const text = String(el.textContent || "").trim();
      if (text === "SCSKiller" && !el.hasAttribute("data-scskiller-button")) {
        out.rail = {
          focusable: (() => {
            try {
              return String(node.GetFocusable());
            } catch (e) {
              return "err";
            }
          })(),
          depth: node.m_nDepth,
          parent: node.m_Parent ? String(node.m_Parent.m_element && node.m_Parent.m_element.className || "").slice(0, 30) : null,
          propsKeys: node.m_Properties ? Object.keys(node.m_Properties).filter((k) => /focus|CanTake/i.test(k)) : null,
        };
      }
      if (el.hasAttribute && el.hasAttribute("data-scskiller-button")) {
        out.gameButton = {
          focusable: (() => {
            try {
              return String(node.GetFocusable());
            } catch (e) {
              return "err";
            }
          })(),
          depth: node.m_nDepth,
          parent: node.m_Parent ? String(node.m_Parent.m_element && node.m_Parent.m_element.className || "").slice(0, 30) : null,
          propsKeys: node.m_Properties ? Object.keys(node.m_Properties).filter((k) => /focus|CanTake/i.test(k)) : null,
        };
      }
    }
    for (const child of node.m_rgChildren || []) walk(child);
  };
  for (const t of trees) walk(t && t.m_Root);
  return JSON.stringify(out, null, 1);
})()
