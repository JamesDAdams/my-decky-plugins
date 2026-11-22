(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = () => (document.body.innerText || "").replace(/\s+/g, " ");
  if (!text().includes("GAME SHADERS")) {
    const entry = Array.from(document.querySelectorAll("button")).find((b) => (b.innerText || "").trim() === "SCSKiller");
    if (entry) { entry.click(); await sleep(1200); }
    const gamesTab = Array.from(document.querySelectorAll("div")).find(
      (el) => (el.innerText || "").trim() === "Games" && el.getBoundingClientRect().width > 40 && el.getBoundingClientRect().width < 220,
    );
    if (gamesTab) { gamesTab.click(); await sleep(600); }
  }
  const row = Array.from(document.querySelectorAll("div")).find((el) => {
    const t = el.innerText || "";
    return t.includes("Dying Light") && t.includes("Compile") && el.getBoundingClientRect().width > 700;
  });
  if (!row) return "row not found";
  const compile = Array.from(row.querySelectorAll("div,span,button")).find((el) => (el.innerText || "").trim() === "Compile");
  if (!compile) return "compile button not found";
  compile.click();
  await sleep(4000);
  return text().slice(0, 300);
})()
