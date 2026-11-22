(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const trees = (context && context.m_rgGamepadNavigationTrees) || [];
  const activeTreeId = context && context.m_LastActiveNavTree && context.m_LastActiveNavTree.id;
  const labels = ["Compile", "Stop", "Refresh", "Close"];
  const seen = new Set();
  const found = [];
  let doc = null;
  const walk = (node, tree) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const el = node.m_element;
    if (el && el.nodeType === 1) {
      if (!doc && el.ownerDocument && el.ownerDocument !== document) doc = el.ownerDocument;
      const text = String(el.textContent || "").trim();
      if (labels.includes(text)) {
        found.push({
          text,
          focusable: (() => {
            try {
              return String(node.GetFocusable());
            } catch (e) {
              return "err";
            }
          })(),
          depth: node.m_nDepth,
          parent: node.m_Parent ? String((node.m_Parent.m_element && node.m_Parent.m_element.className) || "").slice(0, 30) : null,
          treeId: tree && tree.id,
          dialog: (() => {
            let parent = el.parentElement;
            let steps = 0;
            while (parent && steps < 12) {
              if (String(parent.className || "").indexOf("Dialog") >= 0) return true;
              parent = parent.parentElement;
              steps += 1;
            }
            return false;
          })(),
        });
      }
    }
    for (const child of node.m_rgChildren || []) walk(child, tree);
  };
  for (const tree of trees) walk(tree && tree.m_Root, tree);
  const treesInfo = trees.map((t) => ({ id: t.id, hasFocus: typeof t.BIsActiveFocus === "function" ? t.BIsActiveFocus() : null }));
  const focusNode = context && context.m_LastActiveNavTree && context.m_LastActiveNavTree.m_lastFocusNode;
  const focusEl = focusNode && focusNode.m_element;
  return JSON.stringify(
    {
      treeCount: trees.length,
      activeTreeId,
      trees: treesInfo,
      focus: focusEl ? String(focusEl.textContent || "").trim().slice(0, 20) : null,
      buttons: found,
    },
    null,
    1,
  );
})()
