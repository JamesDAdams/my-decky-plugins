// Screenshot a CEF tab through CDP:
//   node tools/shot.mjs "<tab title>" <out.png>
import { writeFileSync } from "node:fs";

const [, , tabTitle, outPath] = process.argv;
const tabs = await (await fetch("http://localhost:8080/json")).json();
const tab = tabs.find((t) => t.title === tabTitle);
if (!tab) {
  console.error("tab not found: " + tabTitle);
  process.exit(1);
}
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let nextId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
function call(method, params = {}, timeoutMs = 25000) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout: " + method)), timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

try {
  await call("Page.enable", {}, 5000).catch(() => {});
  await call("Page.bringToFront", {}, 5000).catch(() => {});
  const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (!shot?.result?.data) {
    console.error("no screenshot data: " + JSON.stringify(shot).slice(0, 300));
    process.exit(2);
  }
  writeFileSync(outPath, Buffer.from(shot.result.data, "base64"));
  console.log("saved " + outPath);
} catch (e) {
  console.error("screenshot failed: " + e.message);
  process.exit(3);
} finally {
  ws.close();
}
