// Press the D-pad for real: Steam listens to `vgp_onbuttondown` / `vgp_onbuttonup` CustomEvents on
// the focused element (sp.js, module 54654). Buttons: DIR_UP=9, DIR_DOWN=10, DIR_LEFT=11, DIR_RIGHT=12.
// Usage: node tools/nav-press.mjs <buttonId> [times] [--inject]
const args = process.argv.slice(2);
const targets = await (await fetch("http://127.0.0.1:8080/json/list")).json();
const target = targets.find((e) => typeof e.title === "string" && e.title.includes("SharedJSContext"));
if (!target) {
  console.error("SharedJSContext not found");
  process.exit(1);
}
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  socket.addEventListener("open", res, { once: true });
  socket.addEventListener("error", rej, { once: true });
});
let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pending.has(data.id)) {
    pending.get(data.id)(data);
    pending.delete(data.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
const evaluate = async (expression) => {
  const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 300));
  return reply.result?.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FOCUS = `(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const tree = context && (context.m_LastActiveNavTree || (context.m_rgGamepadNavigationTrees || [])[0]);
  const node = tree && tree.m_lastFocusNode;
  const el = node && node.m_element;
  if (!el) return null;
  return {
    text: String(el.textContent || "").trim().slice(0, 22),
    label: el.getAttribute && el.getAttribute("aria-label"),
    cls: String(el.className || "").slice(0, 40),
    test: !!(el.hasAttribute && el.hasAttribute("data-scsk-test")),
  };
})()`;

const press = (button) => `(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const tree = context && (context.m_LastActiveNavTree || (context.m_rgGamepadNavigationTrees || [])[0]);
  const node = tree && tree.m_lastFocusNode;
  const el = node && node.m_element;
  if (!el) return "no focused element";
  const view = el.ownerDocument.defaultView;
  const detail = { button: ${button}, source: 1, is_repeat: false };
  const fire = (type) => el.dispatchEvent(new view.CustomEvent(type, { bubbles: true, cancelable: true, detail }));
  const down = fire("vgp_onbuttondown");
  const up = fire("vgp_onbuttonup");
  return JSON.stringify({ down, up, on: String(el.className || "").slice(0, 30) });
})()`;

if (args.includes("--inject")) {
  console.log("inject:", await evaluate(`(() => {
    const manager = window.SteamUIStore.NavigationManager;
    const context = manager.m_ActiveContext;
    const trees = (context && context.m_rgGamepadNavigationTrees) || [];
    const seen = new Set();
    let rowNode = null;
    const walk = (node) => {
      if (!node || typeof node !== "object" || seen.has(node) || rowNode) return;
      seen.add(node);
      const el = node.m_element;
      if (el && el.nodeType === 1 && String(el.className || "").indexOf("_1thLDT") >= 0) rowNode = node;
      for (const child of node.m_rgChildren || []) walk(child);
    };
    for (const tree of trees) walk(tree && tree.m_Root);
    if (!rowNode) return "no row";
    const doc = rowNode.m_element.ownerDocument;
    for (const old of [...doc.querySelectorAll("[data-scsk-test]")]) old.remove();
    rowNode.m_rgChildren = (rowNode.m_rgChildren || []).filter(
      (n) => !(n.m_element && n.m_element.hasAttribute && n.m_element.hasAttribute("data-scsk-test")),
    );
    const template = rowNode.m_rgChildren.find((n) => n.m_element && n.m_element.getAttribute && n.m_element.getAttribute("aria-label") === "Manage");
    if (!template) return "no template";
    const clone = template.m_element.cloneNode(true);
    clone.setAttribute("data-scsk-test", "1");
    clone.setAttribute("aria-label", "SCSKiller test");
    rowNode.m_element.insertBefore(clone, rowNode.m_element.firstChild);
    const node = Object.create(Object.getPrototypeOf(template));
    for (const key of Object.keys(template)) { try { node[key] = template[key]; } catch (e) {} }
    node.m_element = clone;
    node.m_Parent = rowNode;
    node.m_Tree = rowNode.m_Tree;
    node.m_nDepth = rowNode.m_nDepth + 1;
    node.m_rgChildren = [];
    node.m_ActiveChild = null;
    node.m_iLastActiveChildIndex = -1;
    node.m_bMounted = true;
    node.m_Focused = false;
    node.m_FocusWithin = false;
    node.m_bChildrenSorted = true;
    rowNode.m_rgChildren.unshift(node);
    rowNode.m_bChildrenSorted = false;
    rowNode.m_ActiveChild = null;
    return "inserted: children " + rowNode.m_rgChildren.length + ", focusable " + String(node.GetFocusable());
  })()`));
}

const button = Number(args[0] ?? 12);
const times = Number(args[1] ?? 1);
console.log("focus:", JSON.stringify(await evaluate(FOCUS)));
for (let i = 0; i < times; i += 1) {
  const res = await evaluate(press(button));
  await wait(350);
  console.log(`#${i + 1} ${button}: ${res} -> ${JSON.stringify(await evaluate(FOCUS))}`);
}
socket.close();
process.exit(0);
