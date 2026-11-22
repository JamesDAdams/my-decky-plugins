(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const tree = context && (context.m_LastActiveNavTree || (context.m_rgGamepadNavigationTrees || [])[0]);
  if (!tree) return JSON.stringify({ error: "no tree" });
  const treeProto = Object.getPrototypeOf(tree);
  const node = tree.m_lastFocusNode;
  const nodeProto = node ? Object.getPrototypeOf(node) : null;
  const str = (source, name) => (typeof source === "function" ? String(source).slice(0, 700) : name + ": absent");
  return JSON.stringify(
    {
      takeFocus: str(treeProto.TakeFocus, "TakeFocus"),
      transferFocus: str(treeProto.TransferFocus, "TransferFocus"),
      isActiveFocus: typeof tree.BIsActiveFocus === "function" ? tree.BIsActiveFocus() : "?",
      treeBIsActive: typeof tree.BIsActive === "function" ? tree.BIsActive() : "?",
      contextBIsActive: typeof context.BIsActive === "function" ? context.BIsActive() : "?",
      nodeSetDOMFocus: nodeProto ? str(nodeProto.SetDOMFocusAndScroll, "SetDOMFocusAndScroll") : null,
      nodePropsHandlers: node ? Object.keys(node.m_Properties || {}).filter((k) => /onMove|onActivate/.test(k)) : null,
      onMoveRight: node && node.m_Properties && typeof node.m_Properties.onMoveRight === "function" ? String(node.m_Properties.onMoveRight).slice(0, 400) : null,
    },
    null,
    1,
  );
})()
