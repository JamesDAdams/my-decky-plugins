// Probe every Steam CEF target: which one hosts Decky and our plugin bundle?
const list = await (await fetch("http://127.0.0.1:8080/json/list")).json();

const probe = `JSON.stringify({
  href: location.href.slice(0, 110),
  vw: innerWidth,
  vh: innerHeight,
  decky: typeof window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit,
  loader: typeof window.DeckyPluginLoader,
  pluginBundles: performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes(":1337/plugins/")).map((n) => n.replace(/^.*\\/plugins\\//, "").split("/")[0]),
  host: document.querySelectorAll("[data-scskiller-host]").length,
  inner: document.querySelectorAll("._1SvpjsckP9cPRxO6gCBHrw").length
})`;

async function evaluate(target) {
  return new Promise((resolve) => {
    let socket;
    try {
      socket = new WebSocket(target.webSocketDebuggerUrl);
    } catch (error) {
      resolve({ error: String(error) });
      return;
    }
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {}
      resolve({ error: "timeout" });
    }, 5000);
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression: probe, returnByValue: true },
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.id !== 1) return;
      clearTimeout(timer);
      resolve({ value: data.result?.result?.value ?? data.result?.exceptionDetails?.text ?? null });
      try {
        socket.close();
      } catch {}
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      resolve({ error: "socket error" });
    });
  });
}

for (const target of list) {
  if (target.type !== "page") continue;
  const result = await evaluate(target);
  console.log(`--- ${target.title}`);
  if (result.error) console.log(`    ERROR ${result.error}`);
  else console.log(`    ${result.value}`);
}
