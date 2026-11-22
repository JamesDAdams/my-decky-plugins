(() => {
  const doc = (() => {
    const manager = window.SteamUIStore.NavigationManager;
    const context = manager.m_ActiveContext;
    const trees = (context && context.m_rgGamepadNavigationTrees) || [];
    let found = null;
    const seen = new Set();
    const walk = (node) => {
      if (!node || typeof node !== "object" || seen.has(node) || found) return;
      seen.add(node);
      const el = node.m_element;
      if (el && el.ownerDocument && el.ownerDocument !== document) found = el.ownerDocument;
      for (const child of node.m_rgChildren || []) walk(child);
    };
    for (const t of trees) walk(t && t.m_Root);
    return found;
  })();
  if (!doc) return JSON.stringify({ error: "no bpm document" });
  const btn = doc.querySelector("[data-scskiller-button]");
  if (!btn) return JSON.stringify({ error: "no button" });
  const svg = btn.querySelector("svg");
  const path = btn.querySelector("path");
  const box = btn.getBoundingClientRect();
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const atCenter = doc.elementFromPoint(centerX, centerY);
  const cs = (el) => {
    if (!el) return null;
    const style = doc.defaultView.getComputedStyle(el);
    return { color: style.color, fill: style.fill, background: style.backgroundColor, opacity: style.opacity, visibility: style.visibility };
  };
  return JSON.stringify(
    {
      focused: doc.activeElement === btn,
      btn: cs(btn),
      svg: cs(svg),
      path: cs(path),
      fillAttr: svg && svg.getAttribute("fill"),
      pathFillAttr: path && path.getAttribute("fill"),
      children: [...btn.children].map((c) => c.tagName + "." + String(c.className || "")),
      atCenter: atCenter ? atCenter.tagName + "." + String(atCenter.className || "").slice(0, 30) : null,
      atCenterIsInsideButton: atCenter ? btn.contains(atCenter) : null,
      rect: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
    },
    null,
    1,
  );
})()
