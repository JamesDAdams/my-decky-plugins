// Open Big Picture's main menu (the Home / Library / Store rail) and dump every navigation node
// whose element carries one of the wanted labels, with its focus parent and the DOM around it.
// Usage: node ../tools/cdp.mjs SharedJSContext probe-rail.js
(async () => {
  const store = window.SteamUIStore;
  const instance =
    (store.GetFocusedWindowInstance && store.GetFocusedWindowInstance()) ||
    (store.WindowStore && store.WindowStore.GamepadUIMainWindowInstance);
  const menu = instance && instance.MenuStore;
  if (!menu) return "no MenuStore";
  try {
    menu.CloseSideMenus();
  } catch (error) {
    // nothing open
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  let opened = "?";
  try {
    opened = String(menu.OpenMainMenu());
  } catch (error) {
    opened = "throws " + String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const manager = store.NavigationManager;
  const context = manager.m_ActiveContext;
  const trees = context ? Array.from(context.m_rgGamepadNavigationTrees || []) : [];
  const wanted = ["SCSKiller", "Downloads", "Settings", "Home"];
  const hits = [];
  const seen = new Set();
  const label = (node) => {
    const el = node && node.m_element;
    if (!el) return "-";
    return String(el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30) || String(el.className || "").slice(0, 24);
  };
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || seen.has(node) || depth > 30) return;
    seen.add(node);
    const el = node.m_element;
    if (el) {
      const text = String(el.textContent || "").trim();
      if (wanted.includes(text)) {
        const box = el.getBoundingClientRect();
        const doc = el.ownerDocument;
        hits.push({
          text,
          node: {
            focusable: node.GetFocusable ? node.GetFocusable() : "?",
            depth: node.m_nDepth,
            children: (node.m_rgChildren || []).length,
            parent: label(node.m_Parent),
            parentFocusable: node.m_Parent?.GetFocusable ? node.m_Parent.GetFocusable() : "?",
            parentChildren: (node.m_Parent?.m_rgChildren || []).length,
            indexInParent: (node.m_Parent?.m_rgChildren || []).indexOf(node),
            tabIndex: el.getAttribute("tabindex"),
            class: String(el.className || "").slice(0, 60),
            box: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
            doc: doc === document ? "plugin (1x1)" : String(doc.location && doc.location.href).slice(0, 60),
          },
        });
      }
    }
    for (const child of node.m_rgChildren || []) walk(child, depth + 1);
  };
  for (const tree of trees) walk(tree && tree.m_Root, 0);

  return JSON.stringify(
    {
      opened,
      sideMenuVisible: String(menu.IsAnySideMenuVisible()),
      trees: trees.map((tree) => ({ name: String(tree.m_strName ?? tree.m_Name ?? "?").slice(0, 40), depth: tree.m_root?.m_nDepth })),
      hits,
    },
    null,
    1,
  );
})()
