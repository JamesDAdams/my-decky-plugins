// Identify the element the rail's adopted node points at: same document as our injected clone?
// Usage: node ../tools/cdp.mjs SharedJSContext probe-rail-element.js   (main menu open)
(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const trees = context ? Array.from(context.m_rgGamepadNavigationTrees || []) : [];
  let hit = null;
  let hitNode = null;
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || seen.has(node) || hit || depth > 30) return;
    seen.add(node);
    const el = node.m_element;
    if (el) {
      const aria = el.getAttribute && el.getAttribute("aria-label");
      const text = String(el.textContent || "").trim();
      if (aria === "Downloads" && Math.round(el.getBoundingClientRect().y) === 453) {
        hit = el;
        hitNode = node;
        return;
      }
      if (text === "SCSKiller" && Math.round(el.getBoundingClientRect().y) === 453) {
        hit = el;
        hitNode = node;
      }
    }
    for (const child of node.m_rgChildren || []) walk(child, depth + 1);
  };
  for (const tree of trees) walk(tree && tree.m_Root, 0);
  if (!hit) return "no element";

  const doc = hit.ownerDocument;
  const clones = Array.from(doc.querySelectorAll("[data-scsk-menu]"));
  const chain = [];
  let element = hit;
  for (let depth = 0; element && depth < 4; depth++) {
    chain.push({
      tag: element.tagName,
      cls: String(element.className || "").slice(0, 40),
      aria: element.getAttribute && element.getAttribute("aria-label"),
      data: element.getAttribute && element.getAttribute("data-scsk-menu"),
      children: element.children.length,
      rect: (() => {
        const box = element.getBoundingClientRect();
        return [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
      })(),
    });
    element = element.parentElement;
  }
  return JSON.stringify(
    {
      doc: String(doc.location && doc.location.href),
      innerWidth: doc.defaultView && doc.defaultView.innerWidth,
      screenX: doc.defaultView && doc.defaultView.screenX,
      isSameAsClone: clones.length === 1 ? clones[0] === hit : null,
      cloneCount: clones.length,
      cloneAria: clones.map((el) => el.getAttribute("aria-label")),
      connected: hit.isConnected,
      focusable: hitNode.GetFocusable ? hitNode.GetFocusable() : "?",
      html: hit.outerHTML.slice(0, 300),
      chain,
    },
    null,
    1,
  );
})()
