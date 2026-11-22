// Evaluate JS inside Steam's UI via the CEF debugging port (localhost:8080).
// Usage: node tools/cdp-eval.mjs "<expression>" [targetTitleSubstring]
const expression = process.argv[2];
const targetFilter = process.argv[3] ?? "Steam Big Picture Mode";
if (!expression) {
  console.error('usage: node tools/cdp-eval.mjs "<expression>" [target title substring]');
  process.exit(2);
}

const list = await (await fetch("http://127.0.0.1:8080/json/list")).json();
const target =
  list.find((entry) => typeof entry.title === "string" && entry.title.includes(targetFilter)) ??
  list.find((entry) => typeof entry.url === "string" && entry.url.includes("steamloopback"));
if (!target) {
  console.error(`no target matching '${targetFilter}'`);
  process.exit(1);
}
console.error(`# target: ${target.title} (${target.url})`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

const id = 1;
const reply = new Promise((resolve) => {
  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.id === id) resolve(data);
  });
});

socket.send(
  JSON.stringify({
    id,
    method: "Runtime.evaluate",
    params: { expression, returnByValue: true, awaitPromise: true, userGesture: true },
  }),
);

const data = await reply;
if (data.result?.exceptionDetails) {
  console.error(JSON.stringify(data.result.exceptionDetails, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(data.result?.result?.value ?? data.result, null, 2));
socket.close();
