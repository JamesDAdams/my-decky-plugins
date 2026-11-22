// Print the OS window bounds and viewport of a target: node plugins/scskiller/tools/window-bounds.mjs "<tab title>"
const title = process.argv[2] ?? "QuickAccess_uid2";
const tabs = await (await fetch("http://localhost:8080/json")).json();
const tab = tabs.find((t) => t.title === title);
if (!tab) {
  console.error("no tab " + title + " (have " + tabs.map((t) => t.title).join(" | ") + ")");
  process.exit(1);
}
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
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });

const windowInfo = await send("Browser.getWindowForTarget", { targetId: tab.id });
const metrics = await send("Page.getLayoutMetrics");
const state = await send("Runtime.evaluate", {
  expression: "JSON.stringify({inner:[innerWidth,innerHeight],dpr:devicePixelRatio,screen:[screen.availWidth,screen.availHeight],vis:document.visibilityState})",
  returnByValue: true,
});
console.log(
  JSON.stringify(
    {
      window: windowInfo.result,
      viewport: metrics.result?.cssLayoutViewport,
      page: state.result?.result?.value,
    },
    null,
    1,
  ),
);
ws.close();
