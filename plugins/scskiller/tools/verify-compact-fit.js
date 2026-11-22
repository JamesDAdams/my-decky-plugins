(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = () => (document.body.innerText || "").replace(/\s+/g, " ");
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (text().includes("GAME SHADERS") || /SH [\d-]/.test(text())) break;
    const entry = Array.from(document.querySelectorAll("button")).find((b) => (b.innerText || "").trim() === "SCSKiller");
    if (entry) entry.click();
    await sleep(600);
  }
  const root = document.querySelector("[data-scsk-root]");
  const rowRect = (el) => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  };
  const rows = root
    ? Array.from(root.querySelectorAll("div")).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 300 && r.width < 360 && r.height > 24 && r.height < 90 && el.children.length === 3;
      })
    : [];
  const out = rows.slice(0, 4).map((row) => {
    const lines = Array.from(row.querySelectorAll("div")).map((el) => {
      const r = el.getBoundingClientRect();
      return { text: (el.innerText || "").replace(/\s+/g, " ").slice(0, 60), w: Math.round(r.width), scroll: el.scrollWidth, client: el.clientWidth };
    });
    return { row: rowRect(row), text: (row.innerText || "").replace(/\s+/g, " ").slice(0, 120), lines: lines.slice(0, 5) };
  });
  const monoLine = root
    ? Array.from(root.querySelectorAll("div")).find((el) => /^SH /.test((el.innerText || "").trim()))
    : null;
  return JSON.stringify(
    {
      rootWidth: root ? Math.round(root.getBoundingClientRect().width) : null,
      rootOverflow: root ? [root.scrollWidth, root.clientWidth] : null,
      tableHeader: text().includes("GAME SHADERS"),
      monoLine: monoLine
        ? { text: (monoLine.innerText || "").replace(/\s+/g, " "), scroll: monoLine.scrollWidth, client: monoLine.clientWidth }
        : null,
      rows: out,
      legend: /SH = shaders/.test(text()),
    },
    null,
    1,
  );
})()
