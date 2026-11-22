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
  const out = { start: focus(), source: manager.GetSourceType ? manager.GetSourceType() : null, tries: [] };
  for (const [source, button] of [
    [1, 12],
    [1, 11],
    [0, 12],
    [2, 12],
    [1, 5],
  ]) {
    const before = focus();
    manager.DispatchVirtualGamepad("vgp_onbuttondown", { button, source, is_repeat: false });
    await sleep(80);
    manager.DispatchVirtualGamepad("vgp_onbuttonup", { button, source });
    await sleep(200);
    out.tries.push({ source, button, before, after: focus() });
  }
  return JSON.stringify(out, null, 1);
})()
