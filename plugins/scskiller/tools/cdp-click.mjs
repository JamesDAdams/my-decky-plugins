// Trusted mouse click inside a Steam CEF target (CDP Input domain).
// Usage: node tools/cdp-click.mjs <x> <y> [targetTitleSubstring]
const x = Number(process.argv[2]);
const y = Number(process.argv[3]);
const filter = process.argv[4] ?? "Steam Big Picture Mode";

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

await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
await new Promise((resolve) => setTimeout(resolve, 60));
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
console.log(`clicked ${x},${y} in ${target.title}`);
socket.close();
