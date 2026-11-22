// Bring a CEF target to the front and try to capture it (Page.captureScreenshot can hang
// on occluded Steam views, so every step has a timeout).
// Usage: node plugins/scskiller/tools/cdp-shot2.mjs <output.png> [targetTitle]
import { writeFile } from "node:fs/promises";

const output = process.argv[2] ?? "shot.png";
const title = process.argv[3] ?? "QuickAccess_uid2";

const list = await (await fetch("http://127.0.0.1:8080/json")).json();
const target = list.find((entry) => entry.title === title);
if (!target) {
  console.error("no target " + title);
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
const send = (method, params = {}, timeout = 8000) =>
  new Promise((resolve) => {
    const messageId = ++id;
    const timer = setTimeout(() => {
      pending.delete(messageId);
      resolve({ timeout: true, method });
    }, timeout);
    pending.set(messageId, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });

const front = await send("Page.bringToFront");
const enabled = await send("Page.enable");
const reply = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, 15000);
const base64 = reply.result?.data;
if (!base64) {
  console.error("no screenshot data: " + JSON.stringify({ front, enabled, reply }).slice(0, 500));
  process.exit(2);
}
await writeFile(output, Buffer.from(base64, "base64"));
console.log("saved " + output);
socket.close();
