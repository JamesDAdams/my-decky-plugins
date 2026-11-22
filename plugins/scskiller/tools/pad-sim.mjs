// Gamepad simulator for Steam Big Picture.
//
// The controller moves the focus through the navigation trees. Steam exposes the same entry points the
// hardware uses: `NavigationManager.DispatchVirtualGamepad("vgp_onbuttondown"|"vgp_onbuttonup", {button,
// source, is_repeat})`, with `source: 1` (GAMEPAD) and the direction buttons of sp.js
// (`DIR_UP = 9`, `DIR_DOWN = 10`, `DIR_LEFT = 11`, `DIR_RIGHT = 12`). `Tree.TakeFocus(node)` places the
// focus on a known node first, which is how a walk starts.
//
//   node tools/pad-sim.mjs                      where is the focus?
//   node tools/pad-sim.mjs right 3              press right three times
//   node tools/pad-sim.mjs --from Play left 2   start on the node whose text/label is Play, then press
//   node tools/pad-sim.mjs --walk right right   one line per press, with the element and its x
//
// Targets SharedJSContext (the only window that owns SteamUIStore).
const args = process.argv.slice(2);
const BUTTONS = { up: 9, down: 10, left: 11, right: 12, ok: 1, cancel: 2, secondary: 3 };
const targets = await (await fetch("http://127.0.0.1:8080/json/list")).json();
const target = targets.find((t) => typeof t.title === "string" && t.title.includes("SharedJSContext"));
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

const FOCUS = `(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const tree = context && (context.m_LastActiveNavTree || (context.m_rgGamepadNavigationTrees || [])[0]);
  const node = tree && tree.m_lastFocusNode;
  const el = node && node.m_element;
  if (!el) return { found: false };
  const box = el.getBoundingClientRect();
  return {
    found: true,
    label: el.getAttribute && el.getAttribute("aria-label"),
    text: String(el.textContent || "").trim().slice(0, 20),
    cls: String(el.className || "").slice(0, 32),
    depth: node.m_nDepth,
    x: Math.round(box.x),
    y: Math.round(box.y),
    scskiller: !!(el.hasAttribute && el.hasAttribute("data-scskiller-button")),
  };
})()`;

const FOCUS_BY_NAME = (name) => `(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext;
  const trees = (context && context.m_rgGamepadNavigationTrees) || [];
  const tree = context.m_LastActiveNavTree || trees[0];
  const wanted = ${JSON.stringify(name)};
  let hit = null;
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object" || seen.has(node) || hit) return;
    seen.add(node);
    const el = node.m_element;
    if (el) {
      const label = el.getAttribute && el.getAttribute("aria-label");
      const text = String(el.textContent || "").trim();
      if (label === wanted || text === wanted) { hit = node; return; }
    }
    for (const child of node.m_rgChildren || []) walk(child);
  };
  for (const t of trees) walk(t && t.m_Root);
  if (!hit) return "missing";
  tree.TakeFocus(hit);
  return "ok";
})()`;

const PRESS = (button) => `(() => {
  const manager = window.SteamUIStore.NavigationManager;
  manager.DispatchVirtualGamepad("vgp_onbuttondown", { button: ${button}, source: 1, is_repeat: false });
  return "down";
})()`;
const RELEASE = (button) => `(() => {
  const manager = window.SteamUIStore.NavigationManager;
  manager.DispatchVirtualGamepad("vgp_onbuttonup", { button: ${button}, source: 1 });
  return "up";
})()`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const press = async (name) => {
  const button = BUTTONS[name];
  if (button === undefined) throw new Error(`unknown button ${name}`);
  await evaluate(PRESS(button));
  await wait(130);
  await evaluate(RELEASE(button));
  await wait(280);
  return evaluate(FOCUS);
};
const line = (entry) =>
  entry.found
    ? `${entry.scskiller ? "[SCSKILLER] " : ""}${entry.label || entry.text || entry.cls} @${entry.x},${entry.y}`
    : "no focus";

const isButton = (name) => BUTTONS[name] !== undefined;

if (args[0] === "--focus" || args.length === 0) {
  console.log(line(await evaluate(FOCUS)));
} else if (args[0] === "--from") {
  const [, name, ...rest] = args;
  const moved = await evaluate(FOCUS_BY_NAME(name));
  if (moved !== "ok") {
    console.error(`could not focus "${name}"`);
    process.exit(1);
  }
  await wait(250);
  console.log(`from ${name}: ${line(await evaluate(FOCUS))}`);
  for (const step of rest) {
    const entry = await press(step);
    console.log(`  ${step} -> ${line(entry)}`);
  }
} else {
  const walk = args[0] === "--walk" ? args.slice(1) : args;
  // `right 3` means three presses; `right left ok` is a walk
  const steps = walk.length === 2 && isButton(walk[0]) && /^\d+$/.test(walk[1])
    ? Array(Number(walk[1])).fill(walk[0])
    : walk;
  console.log(`start: ${line(await evaluate(FOCUS))}`);
  for (const step of steps) {
    const entry = await press(step);
    console.log(`  ${step} -> ${line(entry)}`);
  }
}
socket.close();
process.exit(0);
