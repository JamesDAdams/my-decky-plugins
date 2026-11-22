// Import dist/index.js into Steam's shared JS context via a data URL (bypasses the
// Decky bundle endpoint) and run the plugin factory, then report the result.
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
const base64 = Buffer.from(source, "utf8").toString("base64");

const list = await (await fetch("http://127.0.0.1:8080/json/list")).json();
const target = list.find((entry) => entry.title === "SharedJSContext");
if (!target) {
  console.error("no SharedJSContext target");
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
    return;
  }
  if (data.method === "Runtime.exceptionThrown") {
    console.log("[exception]", data.params.exceptionDetails.text, data.params.exceptionDetails.exception?.description ?? "");
  }
});

await send("Runtime.enable");

const expression = `(async () => {
  try {
    if (window.__SCSK_TEST__) { try { window.__SCSK_TEST__.onDismount?.(); } catch {} delete window.__SCSK_TEST__; }
    const module = await import("data:text/javascript;base64,${base64}");
    const plugin = module.default();
    window.__SCSK_TEST__ = plugin;
    return JSON.stringify({ ok: true, name: plugin?.name, hasContent: !!plugin?.content, onDismount: typeof plugin?.onDismount });
  } catch (error) {
    return JSON.stringify({ ok: false, error: String(error && (error.stack || error.message || error)) });
  }
})()`;

const result = await send("Runtime.evaluate", {
  expression,
  returnByValue: true,
  awaitPromise: true,
  userGesture: true,
});
console.log(result.result?.result?.value ?? JSON.stringify(result.result?.exceptionDetails ?? result));
await new Promise((resolve) => setTimeout(resolve, 1000));
socket.close();
