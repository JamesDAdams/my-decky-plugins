// Close Steam's Big Picture "Away"/screensaver browser view.
//
// `Screensaver_uid2` swallows every gamepad press (the nav context belongs to it) and it does not
// react to an OS Shift or click from a background shell. Closing its CEF target does dismiss it;
// Steam recreates it after another idle period, so run a walk right after this.
//
// Usage: node tools/kill-screensaver.mjs
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
socket.send(JSON.stringify({ id: 1, method: "Page.close", params: {} }));
await new Promise((resolve) => setTimeout(resolve, 1000));
socket.close();
const after = await (await fetch("http://127.0.0.1:8080/json")).json();
console.log(after.some((target) => String(target.title).startsWith("Screensaver")) ? "screensaver still up" : "screensaver closed");
