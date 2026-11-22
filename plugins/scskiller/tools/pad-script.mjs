// Read the script that implements the virtual gamepad bridge in the Big Picture window, so a
// simulator can send what it really expects.
//   node tools/pad-script.mjs            list scripts whose source mentions vgp_onbuttondown
//   node tools/pad-script.mjs <id> [n]   print n chars around the first vgp_onbuttondown of that script
const args = process.argv.slice(2);
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
const scripts = [];
socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.method === "Debugger.scriptParsed") {
    scripts.push({ scriptId: data.params.scriptId, url: data.params.url, length: data.params.length });
    return;
  }
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
await send("Debugger.enable");
await new Promise((r) => setTimeout(r, 800));

if (!args.length) {
  const hits = [];
  for (const script of scripts) {
    const reply = await send("Debugger.getScriptSource", { scriptId: script.scriptId });
    const source = reply.result?.scriptSource ?? "";
    if (source.includes("vgp_onbuttondown")) hits.push({ scriptId: script.scriptId, url: script.url, length: source.length });
  }
  console.log(JSON.stringify(hits, null, 1));
  socket.close();
  process.exit(0);
}

const scriptId = args[0];
const span = Number(args[1] ?? 1600);
const reply = await send("Debugger.getScriptSource", { scriptId });
const source = reply.result?.scriptSource ?? "";
const index = source.indexOf("vgp_onbuttondown");
console.log(`script ${scriptId}: ${source.length} chars, first vgp_onbuttondown at ${index}`);
if (index >= 0) console.log(source.slice(Math.max(0, index - span / 2), index + span));
socket.close();
process.exit(0);
