(async () => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const trees = (context && context.m_rgGamepadNavigationTrees) || [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tree = context.m_LastActiveNavTree || trees[0];
  const seen = new Set();
  let doc = null;
  let playNode = null;
  const scan = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const el = node.m_element;
    if (el && !doc && el.ownerDocument && el.ownerDocument !== document) doc = el.ownerDocument;
    if (el && String(el.textContent || "").trim() === "Play" && String(el.className || "").indexOf("_3ydigb6z") >= 0) playNode = playNode || node;
    for (const child of node.m_rgChildren || []) scan(child);
  };
  for (const t of trees) scan(t && t.m_Root);
  if (!playNode) return JSON.stringify({ error: "no Play node" });
  const name = () => {
    const node = tree.m_lastFocusNode;
    const el = node && node.m_element;
    if (!el) return "none";
    return (
      ((el.getAttribute && el.getAttribute("aria-label")) || String(el.textContent || "").trim().slice(0, 14) || String(el.className || "").slice(0, 18)) +
      " @" + Math.round(el.getBoundingClientRect().x)
    );
  };
  const press = async (button) => {
    manager.DispatchVirtualGamepad("vgp_onbuttondown", { button, source: 1, is_repeat: false });
    await sleep(120);
    manager.DispatchVirtualGamepad("vgp_onbuttonup", { button, source: 1 });
    await sleep(260);
    return name();
  };
  const out = { steps: [] };
  tree.TakeFocus(playNode);
  out.steps.push({ step: "focus Play", at: name() });
  out.steps.push({ step: "right", at: await press(12) });
  out.steps.push({ step: "right", at: await press(12) });
  out.steps.push({ step: "right", at: await press(12) });
  out.steps.push({ step: "left", at: await press(11) });
  out.steps.push({ step: "left", at: await press(11) });
  out.steps.push({ step: "left", at: await press(11) });
  out.steps.push({ step: "left", at: await press(11) });
  out.steps.push({ step: "down", at: await press(10) });
  return JSON.stringify(out, null, 1);
})()
