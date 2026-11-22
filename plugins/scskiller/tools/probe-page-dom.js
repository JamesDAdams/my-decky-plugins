(() => {
  const labels = ["Clear All", "SCSKiller", "Finished", "Running", "Queued"];
  const hits = {};
  for (const label of labels) {
    const matches = [...document.querySelectorAll("*")].filter(
      (el) => el.children.length === 0 && String(el.textContent || "").trim() === label,
    );
    hits[label] = matches.length;
  }
  const focusables = [...document.querySelectorAll(".Focusable")].map((el) => ({
    cls: String(el.className || "").slice(0, 40),
    text: String(el.textContent || "").trim().slice(0, 30),
    tabindex: el.getAttribute("tabindex"),
  }));
  return JSON.stringify({ hits, focusableCount: focusables.length, focusables: focusables.slice(0, 12) }, null, 1);
})()
