// Dump the DOM ancestry of one games row of the SCSKiller QAM panel, from the plugin context.
// The panel document belongs to another CEF window: reach it through the focused element's
// ownerDocument. Usage: node ../tools/cdp.mjs SharedJSContext probe-qam-row-dom.js
(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const tree = context && (context.m_LastActiveNavTree || (context.m_rgGamepadNavigationTrees || [])[0]);
  const focused = tree && tree.m_lastFocusNode && tree.m_lastFocusNode.m_element;
  const doc = focused && focused.ownerDocument;
  if (!doc) return "no focused document";
  const root = doc.querySelector("[data-scsk-root]");
  if (!root) return "no panel root in " + doc.location.href;
  const matches = Array.from(root.querySelectorAll("div")).filter(
    (el) => (el.textContent || "").trim() === "Solarpunk",
  );
  if (!matches.length) return "row text not found (" + root.querySelectorAll("div").length + " divs)";
  const name = matches[matches.length - 1];
  const chain = [];
  let element = name;
  for (let depth = 0; element && depth < 7; depth++) {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    chain.push({
      tag: element.tagName,
      cls: String(element.className || "").slice(0, 50),
      role: element.getAttribute("role"),
      tabIndex: element.getAttribute("tabindex"),
      display: style.display,
      flexDirection: style.flexDirection,
      rect: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
    });
    element = element.parentElement;
  }
  return JSON.stringify({ doc: doc.location.href, chain }, null, 1);
})()
