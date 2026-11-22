// Drive Big Picture's own gamepad navigation, without a physical controller.
//
// SteamUIStore.NavigationManager exposes the entry points the controller uses:
//   DispatchVirtualGamepad("vgp_onbuttondown", { button, source, is_repeat })
//   DispatchVirtualGamepad("vgp_onbuttonup",   { button, source })
// so a D-pad press can be reproduced and the resulting focus read back - the only honest way to
// check that a control is really reachable with a controller.
//
// Usage:
//   node tools/nav-pad.mjs --focus                 where is the focus now?
//   node tools/nav-pad.mjs <button> [times]        press and report
//   node tools/nav-pad.mjs --sweep 4-13            try ids one by one
//   node tools/nav-pad.mjs --from Downloads 6      focus a rail item, then press
//
// Targets SharedJSContext (it owns SteamUIStore).

const args = process.argv.slice(2);
const targets = await (await fetch("http://127.0.0.1:8080/json/list")).json();
const target = targets.find((entry) => typeof entry.title === "string" && entry.title.includes("SharedJSContext"));
if (!target) {
  console.error("SharedJSContext not found");
  process.exit(1);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
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
  if (reply.result?.exceptionDetails) {
    throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 500));
  }
  return reply.result?.result?.value;
};

const FOCUS = `(() => {
  const manager = window.SteamUIStore.NavigationManager;
  const context = manager.m_ActiveContext || (manager.GetActiveContext && manager.GetActiveContext()) || null;
  if (!context) return { element: null, noContext: true };
  const tree = context.m_LastActiveNavTree || (context.m_rgGamepadNavigationTrees || [])[0];
  const node = tree && (tree.m_lastFocusNode || (tree.GetLastFocusedNode && tree.GetLastFocusedNode()));
  const el = node && node.m_element;
  if (!el) return { element: null };
  const box = el.getBoundingClientRect();
  return {
    element: el.tagName,
    classes: String(el.className || "").slice(0, 70),
    text: (el.textContent || "").trim().slice(0, 40),
    x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height),
    treeId: tree && tree.m_ID,
  };
})()`;

const press = async (button) => {
  await evaluate(
    `window.SteamUIStore.NavigationManager.DispatchVirtualGamepad("vgp_onbuttondown", { button: ${button}, source: 0, is_repeat: false })`,
  );
  await new Promise((resolve) => setTimeout(resolve, 90));
  await evaluate(
    `window.SteamUIStore.NavigationManager.DispatchVirtualGamepad("vgp_onbuttonup", { button: ${button}, source: 0 })`,
  );
  await new Promise((resolve) => setTimeout(resolve, 320));
  return evaluate(FOCUS);
};

const focusNode = async (match) => {
  const found = await evaluate(`(() => {
    const manager = window.SteamUIStore.NavigationManager;
    const context = manager.m_ActiveContext || (manager.GetActiveContext && manager.GetActiveContext());
    const trees = context.m_rgGamepadNavigationTrees || [];
    let hit = null;
    for (const tree of trees) {
      const walk = (node) => {
        if (!node || hit) return;
        const el = node.m_element;
        if (el && (el.textContent || "").trim() === ${JSON.stringify(match)}) hit = { node, tree };
        for (const child of node.m_rgChildren || []) walk(child);
      };
      walk(tree.m_Root);
      if (hit) break;
    }
    if (!hit) return false;
    hit.tree.TakeFocus(hit.node);
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 280));
  return found;
};

if (args[0] === "--from") {
  const [, text, button] = args;
  const took = await focusNode(text);
  const before = await evaluate(FOCUS);
  const after = await press(Number(button));
  console.log(`${took ? "took" : "missing"} ${text} (${before?.text}) --${button}--> ${after?.text} @${after?.x},${after?.y}`);
} else if (args[0] === "--sweep") {
  const [from, to] = (args[1] ?? "4-13").split("-").map(Number);
  for (let button = from; button <= to; button += 1) {
    const before = await evaluate(FOCUS);
    const after = await press(button);
    console.log(`${button}: ${before?.text} -> ${after?.text} @${after?.x},${after?.y}`);
  }
} else if (args.includes("--focus") || args.length === 0) {
  console.log("focus:", JSON.stringify(await evaluate(FOCUS)));
} else {
  const button = Number(args[0]);
  const times = Number(args[1] ?? 1);
  for (let index = 0; index < times; index += 1) {
    const after = await press(button);
    console.log(`${button} #${index + 1}: ${after?.text} @${after?.x},${after?.y}`);
  }
}

socket.close();
process.exit(0);
