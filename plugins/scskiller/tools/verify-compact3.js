(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = () => (document.body.innerText || "").replace(/\s+/g, " ");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (text().includes("GAME SHADERS")) break;
    const entry = Array.from(document.querySelectorAll("button")).find((b) => (b.innerText || "").trim() === "SCSKiller");
    if (entry) entry.click();
    await sleep(500);
  }
  const style = document.querySelector("style#scsk-wide-qam");
  const rule = style ? style.textContent : "";
  const token = (rule.match(/\.(_[A-Za-z0-9-]{6,})/) || [])[1];
  const panel = token ? Array.from(document.querySelectorAll("." + token)).find((el) => el.querySelector("[data-scsk-root]")) : null;
  if (!panel) return JSON.stringify({ error: "panel not found", rule });

  const ruleBackup = style.textContent;
  const inlineBackup = panel.getAttribute("style");
  const markerHad = panel.classList.contains("scsk-wide-qam");

  // narrow the panel the way Steam does (no rule of ours wins this time)
  style.remove();
  panel.style.maxWidth = "300px";
  panel.style.width = "300px";
  await sleep(1400);
  const narrowText = text();
  const narrow = {
    width: Math.round(panel.getBoundingClientRect().width),
    header: narrowText.includes("GAME SHADERS"),
    folded: / SH \| /.test(narrowText),
    sample: narrowText.slice(0, 220),
  };

  // restore the wide panel
  panel.setAttribute("style", inlineBackup ?? "");
  if (!markerHad) panel.classList.remove("scsk-wide-qam");
  style.textContent = ruleBackup;
  if (!document.getElementById("scsk-wide-qam")) document.head.appendChild(style);
  await sleep(900);

  return JSON.stringify(
    {
      narrow,
      restored: { width: Math.round(panel.getBoundingClientRect().width), header: text().includes("GAME SHADERS") },
    },
    null,
    1,
  );
})()
