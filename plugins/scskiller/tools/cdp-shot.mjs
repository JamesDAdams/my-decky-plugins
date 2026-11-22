// Save a PNG screenshot of a Steam CEF target.
// Usage: node tools/cdp-shot.mjs <output.png> [targetTitleSubstring]
import { writeFile } from "node:fs/promises";

const output = process.argv[2] ?? "shot.png";
const filter = process.argv[3] ?? "Steam Big Picture Mode";

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

const reply = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
const base64 = reply.result?.data;
if (!base64) {
  console.error(JSON.stringify(reply));
  process.exit(1);
}
await writeFile(output, Buffer.from(base64, "base64"));
console.log(`saved ${output}`);
socket.close();
