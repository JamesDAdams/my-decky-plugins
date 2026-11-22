// Minimal CDP helper for this machine (Windows Steam + Decky loader).
//
//   node tools/cdp.mjs "<tab title>" <file-with-js-expression>
//
// Prints the evaluated value (string as-is, otherwise JSON) on stdout.
// Exit codes: 0 ok, 1 tab not found / connection error, 2 JS exception.
import { readFileSync } from "node:fs";

const [, , tabTitle, exprFile] = process.argv;
if (!tabTitle || !exprFile) {
  console.error("usage: node cdp.mjs <tabTitle> <expressionFile>");
  process.exit(1);
}

const tabs = await (await fetch("http://localhost:8080/json")).json();
const tab = tabs.find((t) => t.title === tabTitle);
if (!tab) {
  console.error("tab not found: " + tabTitle + " (have: " + tabs.map((t) => t.title).join(" | ") + ")");
  process.exit(1);
}

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = (e) => reject(new Error("websocket error: " + e.message));
});

const expression = readFileSync(exprFile, "utf8");
const id = 1;
const message = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timeout waiting for CDP response")), 20000);
  ws.onmessage = (event) => {
    let parsed;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    if (parsed.id !== id) return;
    clearTimeout(timer);
    resolve(parsed);
  };
  ws.send(
    JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true, userGesture: true, awaitPromise: true },
    }),
  );
});
ws.close();

const result = message?.result;
if (result?.exceptionDetails) {
  console.error("JS EXCEPTION: " + JSON.stringify(result.exceptionDetails, null, 2));
  process.exit(2);
}
const value = result?.result?.value;
if (typeof value === "string") {
  console.log(value);
} else {
  console.log(JSON.stringify(value));
}
