(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = () => (document.body.innerText || "").replace(/\s+/g, " ");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (text().includes("GAME SHADERS") || text().includes("Nothing is compiling")) break;
    const entry = Array.from(document.querySelectorAll("button")).find((b) => (b.innerText || "").trim() === "SCSKiller");
    if (entry) entry.click();
    await sleep(500);
  }
  const style = document.querySelector("style#scsk-wide-qam");
  const rule = style ? style.textContent : "";
  const token = (rule.match(/\.(_[A-Za-z0-9-]{6,})/) || [])[1];
  const panels = token
    ? Array.from(document.querySelectorAll("." + token)).map((el) => {
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          cls: (typeof el.className === "string" ? el.className : "").slice(0, 70),
          width: Math.round(rect.width),
          maxWidth: cs.maxWidth,
          display: cs.display,
          hasOurRoot: Boolean(el.querySelector("[data-scsk-root]")),
        };
      })
    : [];
  return JSON.stringify(
    {
      rule,
      scopedByHas: rule.includes(":has([data-scsk-root])"),
      panels,
      hasRootAttr: Boolean(document.querySelector("[data-scsk-root]")),
    },
    null,
    1,
  );
})()
