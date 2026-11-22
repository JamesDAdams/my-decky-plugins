// Is a UI element reachable with a controller? Ask Steam's gamepad navigation trees.
//
// Big Picture moves the gamepad focus through the navigation trees registered on
// SteamUIStore.NavigationManager.m_ActiveContext.m_rgGamepadNavigationTrees. Each node keeps
// its DOM element in `m_element`, and those elements belong to the visible Big Picture
// document (the plugin context is a 1x1 page, so `document.querySelector` is useless here).
//
// A button the mouse can click but that never appears in that list is exactly what happens
// when a plugin injects markup outside Steam's own focusable components: it is invisible to
// the controller.
//
// Usage (targets SharedJSContext, which owns SteamUIStore):
//   node tools/nav-audit.mjs                       # dump every navigable element
//   node tools/nav-audit.mjs --attr data-scskiller # only elements carrying that attribute
//   node tools/nav-audit.mjs --text SCSKiller      # only elements whose text contains it
//   node tools/nav-audit.mjs --class Focusable --near 1148,366

const args = process.argv.slice(2);
const readOption = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const attr = readOption("--attr");
const text = readOption("--text");
const classFilter = readOption("--class");
const near = readOption("--near");

const targets = await (await fetch("http://127.0.0.1:8080/json/list")).json();
const target = targets.find((entry) => typeof entry.title === "string" && entry.title.includes("SharedJSContext"));
if (!target) {
  console.error("SharedJSContext not found; is Decky running with the CEF debug port open?");
  process.exit(1);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

const options = JSON.stringify({ attr, text, classFilter, near });
const expression = `(() => {
  const options = ${options};
  const manager = window.SteamUIStore && window.SteamUIStore.NavigationManager;
  const context = manager && manager.m_ActiveContext;
  const trees = context ? [...(context.m_rgGamepadNavigationTrees || [])] : [];
  const nodes = [];
  const seen = new Set();
  const info = new Map();
  const walk = (node, depth, treeIndex, parentClasses) => {
    if (!node || typeof node !== "object" || seen.has(node) || depth > 40) return;
    seen.add(node);
    for (const key of Object.keys(node)) {
      let value;
      try { value = node[key]; } catch { continue; }
      if (value && value.nodeType === 1) {
        nodes.push(value);
        const own = String(value.className || "").slice(0, 50);
        info.set(value, { tree: treeIndex, parentClasses, selfClasses: own });
      } else if (Array.isArray(value) && /child|focusable|node/i.test(key)) {
        const self = node.m_element && node.m_element.nodeType === 1 ? String(node.m_element.className || "").slice(0, 50) : parentClasses;
        for (const child of value.slice(0, 200)) walk(child, depth + 1, treeIndex, self);
      }
    }
  };
  trees.forEach((tree, index) => walk(tree && tree.m_Root, 0, index, ""));

  const seenElements = new Set();
  const rows = [];
  for (const element of nodes) {
    if (seenElements.has(element)) continue;
    seenElements.add(element);
    const box = element.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const know = info.get(element) || {};
    const row = {
      classes: String(element.className || "").slice(0, 70),
      tag: element.tagName,
      tree: know.tree,
      parentClasses: know.parentClasses,
      x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height),
      text: (element.textContent || "").trim().slice(0, 30),
      attrs: element.getAttributeNames().filter((name) => name.startsWith("data-")),
    };
    if (options.attr && !element.hasAttribute(options.attr)) continue;
    if (options.text && !row.text.toLowerCase().includes(options.text.toLowerCase())) continue;
    if (options.classFilter && !row.classes.includes(options.classFilter)) continue;
    if (options.near) {
      const [nx, ny] = options.near.split(",").map(Number);
      if (Math.abs(row.x - nx) > 24 || Math.abs(row.y - ny) > 24) continue;
    }
    rows.push(row);
  }
  return { trees: trees.length, nodes: nodes.length, navigable: seenElements.size, matched: rows.length, rows };
})()`;

let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pending.has(data.id)) {
    pending.get(data.id)(data);
    pending.delete(data.id);
  }
});
const send = (method, params) =>
  new Promise((resolve) => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });

const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
if (reply.result?.exceptionDetails) {
  console.error(JSON.stringify(reply.result.exceptionDetails, null, 2).slice(0, 800));
  process.exit(1);
}
console.log(JSON.stringify(reply.result?.result?.value, null, 2));
socket.close();
process.exit(0);
