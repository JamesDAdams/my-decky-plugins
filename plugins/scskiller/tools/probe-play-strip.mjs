// Probe: run the injected top-bar script straight out of src/topBar.ts (no build, no
// Steam restart) and exercise the play-bar strip on the current game page.
//   node tools/probe-play-strip.mjs [appid] [ratio]
import { readFile } from "node:fs/promises";

const appid = Number(process.argv[2] ?? 292000);
const ratio = Number(process.argv[3] ?? 0.124);

const source = await readFile(new URL("../src/topBar.ts", import.meta.url), "utf8");
const start = source.indexOf("const INSTALL = `");
if (start < 0) throw new Error("INSTALL template not found");
const from = source.indexOf("`", start);
const to = source.indexOf("`;", from + 1);
if (to < 0) throw new Error("INSTALL template end not found");
const injected = source
  .slice(from + 1, to)
  .replace(/\\`/g, "`")
  .replace(/\\\\/g, "\\")
  .replace(/\\\$/g, "$");

const expression = `(() => {
  try { window.__scskTopInstalled = false; ${injected} } catch (error) { return "install failed: " + error; }
  if (typeof window.__scskPlayRender !== "function") return "no render function";
  window.__scskPlayRender(${appid}, ${ratio}, false);
  const strip = document.querySelector("[data-scsk-play]");
  const info = document.querySelector("[data-scsk-play-info]");
  const track = document.querySelector("[data-scsk-play-bar-inner]");
  const value = info ? info.children[1] : null;
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
  const play = [...document.querySelectorAll("div,span")].filter(e => !e.children.length && (e.textContent||"").trim() === "Play")
    .map(e => e.closest("[tabindex],button")).filter(Boolean)[0];
  return JSON.stringify({
    pageAppid: play ? window.__scskPageAppid(play) : null,
    playButton: rect(play),
    strip: rect(strip),
    info: rect(info),
    barWidth: track ? Math.round(track.getBoundingClientRect().width) : null,
    valueWidth: value ? Math.round(value.getBoundingClientRect().width) : null,
    oldBar: !!document.querySelector("[data-scsk-play-bar]"),
    html: strip ? strip.innerText.replace(/\\s+/g, " ").trim() : null,
    infoHtml: info ? info.innerText.replace(/\\s+/g, " ").trim() : null,
  });
})()`;

const list = await (await fetch("http://127.0.0.1:8080/json/list")).json();
const target = list.find((entry) => entry.title === "Steam Big Picture Mode");
if (!target) throw new Error("no Steam Big Picture Mode target");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
const reply = new Promise((resolve) => {
  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.id === 7) resolve(data);
  });
});
socket.send(
  JSON.stringify({
    id: 7,
    method: "Runtime.evaluate",
    params: { expression, returnByValue: true, awaitPromise: true, userGesture: true },
  }),
);
const data = await reply;
if (data.result?.exceptionDetails) {
  console.error(JSON.stringify(data.result.exceptionDetails, null, 2));
  process.exit(1);
}
console.log(data.result?.result?.value ?? JSON.stringify(data.result));
socket.close();
