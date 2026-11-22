// Probe every Steam CEF target (title, size, whether it holds the app page DOM).
const list = await (await fetch("http://127.0.0.1:8080/json/list")).json();

const probe = `JSON.stringify({
  href: location.href,
  vw: innerWidth,
  vh: innerHeight,
  text: (document.body?.innerText || "").replace(/\\s+/g, " ").slice(0, 80),
  inner: document.querySelectorAll("._1SvpjsckP9cPRxO6gCBHrw").length,
  controller: document.querySelectorAll("._1oYt_BfxCHnA-_6sfUHiNn").length,
  divs: document.querySelectorAll("div").length
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
  console.log(`--- ${target.title} | ${target.url}`);
  if (result.error) console.log(`    ERROR ${result.error}`);
  else {
    try {
      console.log(`    ${JSON.stringify(JSON.parse(result.value))}`);
    } catch {
      console.log(`    ${result.value}`);
    }
  }
}
