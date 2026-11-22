// Listen to console messages in Steam's shared JS context for a few seconds.
// Usage: node tools/cdp-console.mjs [seconds] [filter]
const seconds = Number(process.argv[2] ?? 8);
const filter = process.argv[3] ?? "";

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
    const text = (data.params.args || []).map((arg) => arg.value ?? arg.description ?? "").join(" ");
    if (!filter || text.includes(filter)) console.log(text);
  }
});

await send("Runtime.enable");
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
socket.close();
