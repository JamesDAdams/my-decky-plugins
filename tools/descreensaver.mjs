// Dismiss Steam's Big Picture screensaver by sending it real input through CDP.
//
// The virtual gamepad dispatch is swallowed while `Screensaver_uid2` is up, and an OS-level Shift or
// click does not always dismiss it (measured 2026-11-22). A trusted CEF key event inside the
// screensaver's own page does.
//
// Usage: node tools/descreensaver.mjs [Escape|Space|Enter]
const key = process.argv[2] ?? "Escape";
const codes = {
  Escape: { windowsVirtualKeyCode: 27, code: "Escape", key: "Escape" },
  Space: { windowsVirtualKeyCode: 32, code: "Space", key: " " },
  Enter: { windowsVirtualKeyCode: 13, code: "Enter", key: "Enter" },
};
const spec = codes[key];
if (!spec) throw new Error("unknown key " + key);

const targets = await (await fetch("http://127.0.0.1:8080/json")).json();
const screensaver = targets.find((target) => typeof target.title === "string" && target.title.startsWith("Screensaver"));
if (!screensaver) {
  console.log("no screensaver target");
  process.exit(0);
}

const socket = new WebSocket(screensaver.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
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

await send("Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: spec.windowsVirtualKeyCode, nativeVirtualKeyCode: spec.windowsVirtualKeyCode, code: spec.code, key: spec.key });
await new Promise((resolve) => setTimeout(resolve, 80));
await send("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: spec.windowsVirtualKeyCode, nativeVirtualKeyCode: spec.windowsVirtualKeyCode, code: spec.code, key: spec.key });
socket.close();
await new Promise((resolve) => setTimeout(resolve, 700));

const after = await (await fetch("http://127.0.0.1:8080/json")).json();
console.log(after.some((target) => String(target.title).startsWith("Screensaver")) ? "screensaver still up" : `screensaver gone (sent ${key})`);
