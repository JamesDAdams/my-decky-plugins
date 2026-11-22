// Click the SCSKiller entry of Decky's plugin list inside the QAM window.
// Usage: node ../tools/cdp.mjs QuickAccess_uid2 open-scsk-panel.js
(() => {
  const candidates = Array.from(document.querySelectorAll("div, button, [role='button']")).filter(
    (el) => (el.textContent || "").trim() === "SCSKiller",
  );
  if (!candidates.length) return "no SCSKiller entry (" + document.body.innerText.slice(0, 120).replace(/\s+/g, " ") + ")";
  const target = candidates[candidates.length - 1];
  const box = target.getBoundingClientRect();
  target.click();
  return "clicked " + candidates.length + " candidate(s) at " + Math.round(box.x) + "," + Math.round(box.y);
})()
