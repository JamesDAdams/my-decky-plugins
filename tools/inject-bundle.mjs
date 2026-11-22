// Runs the *compiled* injected helpers from dist/index.js against the live Big
// Picture window, so what is tested is exactly what the plugin ships.
//
//   node tools/inject-bundle.mjs install "<tab title>"
//   node tools/inject-bundle.mjs poll    "<tab title>"
//   node tools/inject-bundle.mjs destroy "<tab title>"
import { readFileSync } from "node:fs";

const [, , action = "install", tabTitle = "Steam Big Picture Mode"] = process.argv;
const bundleUrl = new URL("../plugins/decky-qam-shortcut/dist/index.js", import.meta.url);
const bundle = readFileSync(bundleUrl, "utf8");

function extractFunction(name) {
  const pattern = new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n");
  const match = bundle.match(pattern);
  if (!match) throw new Error("function " + name + " not found in bundle");
  return match[0].trim();
}

let expression;
if (action === "install") {
  const fn = extractFunction("installPill");
  const cfg = JSON.stringify({ version: 4, enabled: true, label: "Ctrl+2" });
  expression = `(${fn})(${cfg})`;
} else if (action === "poll") {
  expression = `(${extractFunction("pollPill")})()`;
} else if (action === "destroy") {
  expression = `(${extractFunction("destroyPill")})()`;
} else {
  console.error("unknown action: " + action);
  process.exit(1);
}

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
const reply = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timeout")), 20000);
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== 1) return;
    clearTimeout(timer);
    resolve(msg);
  };
  ws.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true, userGesture: true },
    }),
  );
});
ws.close();
const r = reply?.result;
if (r?.exceptionDetails) {
  console.error("JS EXCEPTION: " + JSON.stringify(r.exceptionDetails, null, 2));
  process.exit(2);
}
console.log(typeof r?.result?.value === "string" ? r.result.value : JSON.stringify(r?.result?.value));
