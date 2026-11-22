(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = () => (document.body.innerText || "").replace(/\s+/g, " ");
  const waitFor = async (predicate, attempts = 30) => {
    for (let index = 0; index < attempts; index += 1) {
      if (predicate()) return true;
      await sleep(250);
    }
    return false;
  };

  // 1. the plugin page must be open inside the QAM
  if (!(await waitFor(() => text().includes("GAMES IN SCSKILLER") || text().includes("GAME SHADERS") || text().includes("Nothing is compiling"), 8))) {
    const entry = Array.from(document.querySelectorAll("button")).find((b) => (b.innerText || "").trim() === "SCSKiller");
    if (entry) {
      entry.click();
      await waitFor(() => text().includes("GAME SHADERS") || text().includes("Nothing is compiling"), 20);
    }
  }

  const styleEl = document.querySelector("style#scsk-wide-qam");
  const rule = styleEl ? styleEl.textContent : null;

  // the widest ancestor that holds our panel: Steam's QAM tab column
  const rows = Array.from(document.querySelectorAll("*")).filter((el) => {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return rect.width > 400 && rect.height > 30 && rect.height < 90 && cs.display === "flex" && el.children.length >= 8;
  });
  const firstRow = rows[0];
  let panel = firstRow;
  while (panel && panel.parentElement && panel.getBoundingClientRect().width >= panel.parentElement.getBoundingClientRect().width - 1) {
    panel = panel.parentElement;
  }
  const panelRect = panel ? panel.getBoundingClientRect() : null;

  const wide = {
    styleRule: rule,
    panelWidth: panelRect ? Math.round(panelRect.width) : null,
    rowWidth: firstRow ? Math.round(firstRow.getBoundingClientRect().width) : null,
    header: text().includes("GAME SHADERS PIPELINES CACHE TIME STATUS"),
    tabs: ["Compiling", "Games", "Setup"].filter((label) => text().includes(label)),
    logo: firstRow ? (() => {
      const img = firstRow.querySelector("img");
      return img ? { src: img.src.split("/").slice(-1)[0], size: [img.naturalWidth, img.naturalHeight] } : null;
    })() : null,
    cells: firstRow ? Array.from(firstRow.children).slice(1, 7).map((cell) => (cell.innerText || "").replace(/\s+/g, " ").slice(0, 60)) : null,
  };

  // 2. fall back to a narrow QAM (the way a 348px panel would look) and check the rows fold
  let narrow = null;
  if (styleEl && firstRow) {
    styleEl.textContent = rule.replace("max-width:none", "max-width:300px");
    await sleep(900);
    const folded = text();
    narrow = {
      panelWidth: panelRect ? Math.round(panel.getBoundingClientRect().width) : null,
      tableHeader: folded.includes("GAME SHADERS"),
      foldedLine: / SH \| /.test(folded),
      sample: folded.slice(folded.indexOf("Compiling") + 9, folded.indexOf("Compiling") + 200),
    };
    styleEl.textContent = rule;
    await sleep(700);
  }

  return JSON.stringify({ wide, narrow, restored: text().includes("GAME SHADERS") }, null, 1);
})()
