(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = () => (document.body.innerText || "").replace(/\s+/g, " ");
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (text().includes("GAME SHADERS") || text().includes(" SH | ") || text().includes("Nothing is compiling")) break;
    const entry = Array.from(document.querySelectorAll("button")).find((b) => (b.innerText || "").trim() === "SCSKiller");
    if (entry) entry.click();
    await sleep(600);
  }
  const style = document.querySelector("style#scsk-wide-qam");
  const panel = Array.from(document.querySelectorAll("div")).find((el) => el.querySelector && el.querySelector("[data-scsk-root]"));
  const root = document.querySelector("[data-scsk-root]");
  const v = window;
  const screenWidth = Math.max(v.screen?.availWidth || 0, v.screen?.width || 0);
  const left = Math.round(v.screenX || 0);
  const width = Math.round(v.outerWidth || 0);
  const rect = panel ? panel.getBoundingClientRect() : null;
  return JSON.stringify(
    {
      rule: style ? style.textContent : null,
      screen: screenWidth,
      windowLeft: left,
      windowWidth: width,
      visibleStrip: Math.max(0, Math.min(width, screenWidth - left)),
      wholeWindowOnScreen: left + width <= screenWidth + 2,
      panelWidth: rect ? Math.round(rect.width) : null,
      rootWidth: root ? Math.round(root.getBoundingClientRect().width) : null,
      overflow: panel ? [panel.scrollWidth, panel.clientWidth] : null,
      tableHeader: text().includes("GAME SHADERS"),
      folded: / SH \| /.test(text()),
      tabs: ["Compiling", "Games", "Setup"].filter((label) => text().includes(label)),
    },
    null,
    1,
  );
})()
