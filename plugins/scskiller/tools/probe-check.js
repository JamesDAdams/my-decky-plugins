(() => {
  const out = {
    href: String(location.href).slice(0, 60),
    path: location.pathname,
    button: !!document.querySelector("[data-scskiller-button]"),
    overlay: !!document.querySelector("[data-scskiller='overlay']"),
  };
  const icon = document.querySelector('[aria-label="Configure Controller"]');
  out.icon = !!icon;
  if (icon) {
    const row = icon.parentElement && icon.parentElement.parentElement;
    out.rowClass = row ? String(row.className || "").slice(0, 50) : null;
    if (row) {
      const r = row.getBoundingClientRect();
      out.row = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      out.kids = [...row.children].map((c) => ({
        tag: c.tagName,
        cls: String(c.className || "").slice(0, 40),
        label: c.getAttribute && c.getAttribute("aria-label"),
        btn: c.hasAttribute && c.hasAttribute("data-scskiller-button"),
        text: String(c.textContent || "").slice(0, 20),
        rect: (() => { const b = c.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width) }; })(),
      }));
    }
  }
  const our = document.querySelector("[data-scskiller-button]");
  if (our) {
    const b = our.getBoundingClientRect();
    out.btnRect = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  }
  return JSON.stringify(out, null, 1);
})()
