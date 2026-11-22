// Drive Steam's gamepad/keyboard navigation in the QAM and report where the focus lands.
// Usage: node plugins/scskiller/tools/qam-nav.mjs [Right|Left|Down|Up ...]
const keys = process.argv.slice(2);
if (!keys.length) keys.push("Right", "Down", "Up");

const tabs = await (await fetch("http://localhost:8080/json")).json();
const qam = tabs.filter((t) => /^QuickAccess_/.test(t.title)).pop();
if (!qam) throw new Error("no QuickAccess tab");

const ws = new WebSocket(qam.webSocketDebuggerUrl);
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
const send = (method, params) =>
  new Promise((resolve) => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true })).result?.result?.value;

console.log("start:", await evaluate(`(() => {
  const root = document.querySelector("[data-scsk-root]");
  const all = Array.from(root.querySelectorAll("*"));
  const row = all.find((el) => (el.innerText || "").startsWith("Dying Light") && el.getAttribute("tabindex") === "0");
  row.focus();
  return JSON.stringify({ focused: document.activeElement === row, text: (document.activeElement.innerText || "").split("\\n")[0] });
})()`));

for (const key of keys) {
  const code = key.startsWith("Arrow") ? key : `Arrow${key}`;
  const vk = { ArrowRight: 39, ArrowLeft: 37, ArrowUp: 38, ArrowDown: 40 }[code] ?? 0;
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: vk, code, key: code });
  await send("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: vk, code, key: code });
  await new Promise((r) => setTimeout(r, 350));
  console.log(
    `${key}:`,
    await evaluate(`JSON.stringify({ active: (document.activeElement.innerText || "").trim().slice(0, 20), tag: document.activeElement.tagName, isButton: /^Compile|Stop|Blocked$/.test((document.activeElement.innerText || "").trim()) })`),
  );
}
ws.close();
