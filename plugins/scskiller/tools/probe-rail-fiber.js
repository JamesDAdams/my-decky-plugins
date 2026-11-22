// Compare the React props of our rail entry with the native "Downloads" one: which prop carries
// the activation (onClick / onActivate / link / route / onSelected)?
// Usage: node ../tools/cdp.mjs SharedJSContext probe-rail-fiber.js   (main menu open)
(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const trees = context ? Array.from(context.m_rgGamepadNavigationTrees || []) : [];
  const wanted = { Downloads: null, SCSKiller: null };
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || seen.has(node) || depth > 30) return;
    seen.add(node);
    const el = node.m_element;
    if (el) {
      const aria = el.getAttribute && el.getAttribute("aria-label");
      const text = String(el.textContent || "").trim();
      const box = el.getBoundingClientRect();
      if (aria === "Downloads" && Math.round(box.y) === 403) wanted.Downloads = el;
      if (aria === "Downloads" && Math.round(box.y) === 453) wanted.SCSKiller = el;
      if (text === "SCSKiller" && Math.round(box.y) === 453) wanted.SCSKiller = el;
    }
    for (const child of node.m_rgChildren || []) walk(child, depth + 1);
  };
  for (const tree of trees) walk(tree && tree.m_Root, 0);

  const fiberOf = (element) => {
    if (!element) return null;
    const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
    return key ? element[key] : null;
  };
  const describeValue = (value) => {
    if (value === null || value === undefined) return String(value);
    const type = typeof value;
    if (type === "function") return "fn(" + (value.name || "anonymous") + ")";
    if (type === "string") return JSON.stringify(value.slice(0, 40));
    if (type === "boolean" || type === "number") return String(value);
    if (Array.isArray(value)) return "array[" + value.length + "]";
    if (value.$$typeof) return "element";
    return "object{" + Object.keys(value).slice(0, 6).join(",") + "}";
  };
  const chainOf = (element) => {
    const chain = [];
    let fiber = fiberOf(element);
    for (let i = 0; fiber && i < 12; i++) {
      const type = fiber.type;
      const name = typeof type === "string" ? type : type?.displayName || type?.name || (type?.render ? "forwardRef:" + (type.render.displayName || type.render.name || "?") : "?");
      const props = fiber.memoizedProps || {};
      const keys = Object.keys(props).filter((key) => key !== "children");
      const interesting = {};
      for (const key of keys) {
        if (/click|activate|select|link|route|nav|tab|select|onFocus|title|icon|content|id|page/i.test(key)) {
          interesting[key] = describeValue(props[key]);
        }
      }
      chain.push({ name: String(name).slice(0, 40), props: keys.slice(0, 18), interesting });
      fiber = fiber.return;
    }
    return chain;
  };
  return JSON.stringify(
    {
      found: Object.fromEntries(Object.entries(wanted).map(([key, element]) => [key, Boolean(element)])),
      downloads: chainOf(wanted.Downloads),
      scskiller: chainOf(wanted.SCSKiller),
    },
    null,
    1,
  );
})()
