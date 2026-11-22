// Open the Decky QAM tab, then evaluate an expression in the QuickAccess target.
// Usage: node plugins/scskiller/tools/qam-probe.mjs <exprFile> [delayMs]
import { readFileSync } from "node:fs";

const exprFile = process.argv[2];
const delay = Number(process.argv[3] ?? 1500);

const tabs = await (await fetch("http://localhost:8080/json")).json();

/** Steam restarts renumber the target (`QuickAccess_uid2`, `_uid13`, ...): take any of them. */
function pickQuickAccess(list) {
  const matches = list.filter((t) => /^QuickAccess_/.test(t.title));
  if (!matches.length) throw new Error("no QuickAccess tab (have " + list.map((t) => t.title).join(" | ") + ")");
  const preferred = matches.find((t) => t.title === "QuickAccess_uid2");
  return (preferred ?? matches[matches.length - 1]).title;
}

async function connect(title) {
  const tab = tabs.find((t) => t.title === title);
  if (!tab) throw new Error("no tab " + title + " (have " + tabs.map((t) => t.title).join(" | ") + ")");
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("ws error"));
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const evaluate = (expression) =>
    new Promise((resolve) => {
      const messageId = ++id;
      pending.set(messageId, (msg) => resolve(msg));
      ws.send(
        JSON.stringify({
          id: messageId,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, userGesture: true, awaitPromise: true },
        }),
      );
    });
  return { ws, evaluate };
}

const shared = await connect("SharedJSContext");
const opened = await shared.evaluate(
  `(() => { const s = window.SteamUIStore; const i = (s.GetFocusedWindowInstance && s.GetFocusedWindowInstance()) || (s.WindowStore && s.WindowStore.GamepadUIMainWindowInstance); const m = i && i.MenuStore; if (!m) return "no MenuStore"; m.OpenQuickAccessMenu(999); return "tab=" + m.GetQuickAccessTab() + " visible=" + m.IsAnySideMenuVisible(); })()`,
);
console.error("open: " + opened.result?.result?.value);
shared.ws.close();

const qam = await connect(pickQuickAccess(tabs));
await new Promise((resolve) => setTimeout(resolve, delay));
const reply = await qam.evaluate(readFileSync(exprFile, "utf8"));
qam.ws.close();
if (reply.result?.exceptionDetails) {
  console.error("EXCEPTION " + JSON.stringify(reply.result.exceptionDetails));
  process.exit(2);
}
const value = reply.result?.result?.value;
console.log(typeof value === "string" ? value : JSON.stringify(value));
