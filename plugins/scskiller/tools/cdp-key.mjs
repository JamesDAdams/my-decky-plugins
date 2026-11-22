// Send a key to a Steam CEF target (CDP Input domain).
// Usage: node tools/cdp-key.mjs <key> [targetTitleSubstring]
//   keys: Escape, Enter, Tab, ArrowDown, ArrowUp, ArrowLeft, ArrowRight
const key = process.argv[2] ?? "Escape";
const filter = process.argv[3] ?? "Steam Big Picture Mode";

const codes = {
  Escape: 27,
  Enter: 13,
  Tab: 9,
  ArrowDown: 40,
  ArrowUp: 38,
  ArrowLeft: 37,
  ArrowRight: 39,
};

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
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pending.has(data.id)) {
    pending.get(data.id)(data);
    pending.delete(data.id);
  }
});

const base = {
  key,
  code: key,
  windowsVirtualKeyCode: codes[key] ?? 0,
  nativeVirtualKeyCode: codes[key] ?? 0,
};
await send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
await new Promise((resolve) => setTimeout(resolve, 40));
await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
console.log(`sent ${key} to ${target.title}`);
socket.close();
