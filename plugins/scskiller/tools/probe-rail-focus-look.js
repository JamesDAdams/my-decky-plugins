// What does Steam change on a rail item when the gamepad focus lands on it?
// Takes the focus on "Settings", reads class + computed style of the item and of its label,
// moves the focus away, reads again, then restores it.
// Usage: node ../tools/cdp.mjs SharedJSContext probe-rail-focus-look.js   (main menu open)
(async () => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const tree = context && (context.m_LastActiveNavTree || (context.m_rgGamepadNavigationTrees || [])[0]);
  const group = (() => {
    let found = null;
    const seen = new Set();
    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || seen.has(node) || found || depth > 20) return;
      seen.add(node);
      const el = node.m_element;
      if (el && (el.textContent || "").includes("Home") && (node.m_rgChildren || []).length >= 8) {
        found = node;
        return;
      }
      for (const child of node.m_rgChildren || []) walk(child, depth + 1);
    };
    for (const candidate of Array.from(context?.m_rgGamepadNavigationTrees || [])) walk(candidate.m_Root, 0);
    return found;
  })();
  if (!group) return "sidebar group not found";

  const itemOf = (text) => {
    for (const child of group.m_rgChildren || []) {
      const el = child.m_element;
      if (el && String(el.textContent || "").trim() === text) return { node: child, el };
    }
    return null;
  };
  const settings = itemOf("Settings");
  const home = itemOf("Home");
  if (!settings || !home) return "items not found";

  const snapshot = (element) => {
    const label = element.querySelector("div div") || element;
    const style = getComputedStyle(element);
    const labelStyle = getComputedStyle(label);
    const left = element.querySelector("div");
    return {
      class: String(element.className),
      background: style.backgroundColor,
      backgroundImage: style.backgroundImage.slice(0, 60),
      color: style.color,
      labelClass: String(label.className),
      labelColor: labelStyle.color,
      firstChildClass: String(left?.className || ""),
      firstChildBackground: left ? getComputedStyle(left).backgroundColor : null,
      firstChildWidth: left ? getComputedStyle(left).width : null,
    };
  };

  tree.TakeFocus(settings.node);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const focused = snapshot(settings.el);
  tree.TakeFocus(home.node);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const unfocused = snapshot(settings.el);
  return JSON.stringify({ focused, unfocused, lastFocus: String(tree.m_lastFocusNode?.m_element?.textContent || "").trim() }, null, 1);
})()
