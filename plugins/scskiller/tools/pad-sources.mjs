// Dump the source of the handlers Steam attaches for the virtual gamepad events, so a simulator can
// build events that the navigation actually accepts.
const targets = await (await fetch("http://127.0.0.1:8080/json/list")).json();
const target = targets.find((t) => typeof t.title === "string" && t.title.includes("Steam Big Picture Mode"));
if (!target) {
  console.error("Steam Big Picture Mode not found");
  process.exit(1);
}
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  socket.addEventListener("open", res, { once: true });
  socket.addEventListener("error", rej, { once: true });
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
const evaluate = async (expression, byValue = true) => {
  const reply = await send("Runtime.evaluate", { expression, returnByValue: byValue, awaitPromise: true });
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 200));
  return byValue ? reply.result?.result?.value : reply.result?.result;
};

const dump = async (index, wanted) => {
  const object = await evaluate(
    `(() => { let el = document.activeElement; for (let i = 0; i < ${index} && el; i += 1) el = el.parentElement; return el; })()`,
    false,
  );
  if (!object?.objectId) return null;
  const reply = await send("DOMDebugger.getEventListeners", { objectId: object.objectId, depth: 0, pierce: false });
  const out = [];
  for (const listener of reply.result?.listeners ?? []) {
    if (!wanted.includes(listener.type)) continue;
    if (!listener.handler?.objectId) {
      out.push({ type: listener.type, useCapture: listener.useCapture, note: "no handler object", scriptId: listener.scriptId, line: listener.lineNumber });
      continue;
    }
    const handler = await send("Runtime.callFunctionOn", {
      objectId: listener.handler.objectId,
      functionDeclaration: "function () { return String(this); }",
      returnByValue: true,
    });
    out.push({ type: listener.type, useCapture: listener.useCapture, source: String(handler.result?.result?.value ?? "?").slice(0, 700) });
  }
  return out;
};

console.log("focused:", JSON.stringify(await evaluate(`(() => ({ cls: String(document.activeElement.className || "").slice(0, 40), text: String(document.activeElement.textContent || "").trim().slice(0, 16) }))()`)));
for (const index of [0, 1, 16]) {
  console.log(`\n--- ancestor ${index} ---`);
  console.log(JSON.stringify(await dump(index, ["vgp_ondirection", "vgp_onbuttondown"]), null, 1));
}
socket.close();
process.exit(0);
