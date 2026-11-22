(async () => {
  const manager = window.SteamUIStore.NavigationManager;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const focus = () => {
    const context = manager.m_ActiveContext;
    const tree = context && (context.m_LastActiveNavTree || (context.m_rgGamepadNavigationTrees || [])[0]);
    const node = tree && tree.m_lastFocusNode;
    const el = node && node.m_element;
    if (!el) return "none";
    const label = el.getAttribute && el.getAttribute("aria-label");
    const text = String(el.textContent || "").trim().slice(0, 16);
    return `${label || text || String(el.className || "").slice(0, 18)} @${Math.round(el.getBoundingClientRect().x)}`;
  };
  const press = async (button, source) => {
    manager.DispatchVirtualGamepad("vgp_onbuttondown", { button, source, is_repeat: false });
    await sleep(120);
    manager.DispatchVirtualGamepad("vgp_onbuttonup", { button, source });
    await sleep(260);
    return focus();
  };
  const out = { start: focus(), hasDispatch: typeof manager.DispatchVirtualGamepad === "function", source: manager.GetSourceType ? manager.GetSourceType() : null, presses: [] };
  for (const source of [1, 0, 2]) {
    for (let button = 0; button <= 16; button += 1) {
      const before = focus();
      const after = await press(button, source);
      if (after !== before) out.presses.push({ source, button, before, after });
    }
  }
  out.end = focus();
  return JSON.stringify(out, null, 1);
})()
