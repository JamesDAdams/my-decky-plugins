// Re-import the SCSKiller plugin frontend inside Decky and capture console errors.
// Usage: node tools/cdp-reload.mjs [pluginName] [version]
const name = process.argv[2] ?? "SCSKiller";
const version = process.argv[3] ?? "0.5.0";

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
  if (data.method === "Runtime.consoleAPICalled") {
    const text = (data.params.args || [])
      .map((arg) => arg.value ?? arg.description ?? arg.type)
      .join(" ");
    console.log(`[console:${data.params.type}] ${text}`);
  }
  if (data.method === "Runtime.exceptionThrown") {
    const details = data.params.exceptionDetails;
    console.log(`[exception] ${details.text} ${details.exception?.description ?? ""}`);
  }
});

await send("Runtime.enable");
await send("Log.enable");

const expression = `(async () => {
  try {
    const loader = window.DeckyPluginLoader;
    await loader.importPlugin(${JSON.stringify(name)}, ${JSON.stringify(version)});
    return "imported; plugins=" + (loader.plugins || []).map((p) => p.name).join(",");
  } catch (error) {
    return "ERROR: " + (error && (error.stack || error.message || String(error)));
  }
})()`;

const result = await send("Runtime.evaluate", {
  expression,
  returnByValue: true,
  awaitPromise: true,
  userGesture: true,
});
console.log("result:", JSON.stringify(result.result?.result?.value ?? result.result?.exceptionDetails ?? result));
await new Promise((resolve) => setTimeout(resolve, 2500));
socket.close();
