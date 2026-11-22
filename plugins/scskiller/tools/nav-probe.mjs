// Drive Big Picture's focus navigation from a script (keyboard input source, same
// FocusNavController as the gamepad) and report where focus lands.
//
// Usage:
//   node tools/nav-probe.mjs [left|right|up|down]+ [targetTitleSubstring]
//   node tools/nav-probe.mjs reset right right right
//
// Each step prints the focused element: its classes, geometry and a short text.

const raw = process.argv.slice(2);
const filter = raw.length && !/^(reset|left|right|up|down)$/.test(raw[raw.length - 1]) ? raw.pop() : "Steam Big Picture Mode";
const steps = raw.length ? raw : ["right"];

const list = await (await fetch("http://127.0.0.1:8080/json/list")).json();
const target = list.find((entry) => typeof entry.title === "string" && entry.title.includes(filter));
if (!target) {
  console.error(`no target matching '${filter}'`);
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
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails));
  return reply.result?.result?.value;
};

const KEY = {
  left: { code: "ArrowLeft", key: "ArrowLeft", windowsVirtualKeyCode: 37 },
  up: { code: "ArrowUp", key: "ArrowUp", windowsVirtualKeyCode: 38 },
  right: { code: "ArrowRight", key: "ArrowRight", windowsVirtualKeyCode: 39 },
  down: { code: "ArrowDown", key: "ArrowDown", windowsVirtualKeyCode: 40 },
  enter: { code: "Enter", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  escape: { code: "Escape", key: "Escape", windowsVirtualKeyCode: 27 },
};

const focused = () =>
  evaluate(`(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: el ? el.tagName : null, classes: null };
    const box = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      classes: String(el.className || "").slice(0, 90),
      x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height),
      marks: el.dataset && el.dataset.scskiller ? Object.assign({}, el.dataset) : null,
      text: (el.textContent || "").trim().slice(0, 40),
    };
  })()`);

const blur = () =>
  evaluate(`(() => { const el = document.activeElement; if (el && el.blur) el.blur(); return true; })()`);

console.log("start:", JSON.stringify(await focused()));

for (const step of steps) {
  if (step === "reset") {
    await blur();
    console.log("reset: focus cleared");
    continue;
  }
  const key = KEY[step];
  if (!key) {
    console.error(`unknown step '${step}'`);
    continue;
  }
  await send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    code: key.code,
    key: key.key,
    windowsVirtualKeyCode: key.windowsVirtualKeyCode,
    nativeVirtualKeyCode: key.windowsVirtualKeyCode,
    text: key.text ?? "",
    unmodifiedText: key.text ?? "",
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    code: key.code,
    key: key.key,
    windowsVirtualKeyCode: key.windowsVirtualKeyCode,
    nativeVirtualKeyCode: key.windowsVirtualKeyCode,
  });
  await new Promise((resolve) => setTimeout(resolve, 350));
  console.log(`${step}:`, JSON.stringify(await focused()));
}

socket.close();
process.exit(0);
