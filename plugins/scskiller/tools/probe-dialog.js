(() => {
  const dialogs = [...document.querySelectorAll("[role='dialog']")];
  const button = document.querySelector("[data-scskiller-button]");
  const rect = button ? button.getBoundingClientRect() : null;
  return JSON.stringify(
    {
      dialogs: dialogs.length,
      dialogText: dialogs.map((d) => String(d.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120)),
      button: !!button,
      rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      svg: button ? !!button.querySelector("svg") : false,
      dot: button ? !!button.querySelector("[data-scskiller-dot]") : false,
    },
    null,
    1,
  );
})()
