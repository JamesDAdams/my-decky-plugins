(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = () => (document.body.innerText || "").replace(/\s+/g, " ");
  const compilingTab = Array.from(document.querySelectorAll("div")).find(
    (el) => (el.innerText || "").trim().startsWith("Compiling") && el.getBoundingClientRect().width > 40 && el.getBoundingClientRect().width < 220,
  );
  if (compilingTab) { compilingTab.click(); await sleep(600); }
  const before = text().slice(0, 300);
  const stop = Array.from(document.querySelectorAll("div,span,button")).find((el) => (el.innerText || "").trim() === "Stop");
  if (!stop) return JSON.stringify({ stopped: false, before });
  stop.click();
  await sleep(4000);
  return JSON.stringify({ stopped: true, before, after: text().slice(0, 400) }, null, 1);
})()
