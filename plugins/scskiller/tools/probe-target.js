(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const out = { keys: [] };
  try {
    out.catchAll = (manager.m_rgCatchAllGamepadInput || []).length;
  } catch (e) {
    out.catchAll = "err";
  }
  for (const button of [9, 10, 11, 12]) {
    const entry = {};
    try {
      const target = manager.GetEventTarget(button, 1, true);
      entry.target = Array.isArray(target)
        ? target.map((item) =>
            item && item.nodeType === 1
              ? "el:" + String(item.className || "").slice(0, 24)
              : item && item.m_LastActiveNavTree
                ? "tree:" + item.m_LastActiveNavTree.id
                : typeof item,
          )
        : String(target);
      if (Array.isArray(target) && target[1]) {
        const tree = target[1];
        entry.suppressed = typeof tree.BIsGamepadInputSuppressed === "function" ? tree.BIsGamepadInputSuppressed() : "?";
        entry.enabled = typeof tree.BIsEnabled === "function" ? tree.BIsEnabled() : "?";
        entry.treeId = tree.id || (tree.m_LastActiveNavTree && tree.m_LastActiveNavTree.id) || String(tree).slice(0, 20);
      }
    } catch (e) {
      entry.error = String(e.message);
    }
    out["button" + button] = entry;
  }
  out.activeContext = !!manager.m_ActiveContext;
  out.lastActiveContext = !!manager.m_LastActiveContext;
  out.sourceType = typeof manager.GetSourceType === "function" ? manager.GetSourceType() : "no GetSourceType";
  out.navigationSource = manager.m_navigationSource;
  return JSON.stringify(out, null, 1);
})()
