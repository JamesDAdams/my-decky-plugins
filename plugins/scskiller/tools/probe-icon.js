(() => {
  const describe = (t) => {
    if (t == null) return "null";
    if (typeof t === "string") return "host:" + t;
    if (typeof t === "function") return "fn:" + (t.displayName || t.name || "anon");
    if (typeof t === "symbol") return "sym:" + String(t);
    if (typeof t === "object") {
      const tag = String(t.$$typeof || "").replace("Symbol(", "").replace(")", "");
      const inner = t.type || t.render;
      const name = (inner && (inner.displayName || inner.name)) || t.displayName || t.name || "?";
      return "obj:" + tag + "/" + (typeof inner === "function" ? "fn" : typeof inner) + ":" + name;
    }
    return typeof t;
  };
  const out = { href: String(location.href), hasIcon: false };
  const icon = document.querySelector('[aria-label="Configure Controller"]');
  out.hasIcon = !!icon;
  if (!icon) {
    out.sample = [...document.querySelectorAll("[aria-label]")].slice(0, 10).map((e) => e.getAttribute("aria-label"));
    return JSON.stringify(out);
  }
  const fkey = Object.keys(icon).find((k) => k.indexOf("__reactFiber$") === 0);
  let fiber = fkey ? icon[fkey] : null;
  const chain = [];
  let level = 0;
  while (fiber && level < 26) {
    const props = fiber.memoizedProps;
    chain.push({
      i: level,
      tag: fiber.tag,
      type: describe(fiber.elementType),
      cls: props && typeof props.className === "string" ? props.className.slice(0, 60) : undefined,
      keys: props && typeof props === "object" ? Object.keys(props).slice(0, 12) : undefined,
    });
    fiber = fiber.return;
    level += 1;
  }
  out.chain = chain;
  const row = icon.parentElement && icon.parentElement.parentElement;
  if (row) {
    const r = row.getBoundingClientRect();
    out.row = { cls: String(row.className || "").slice(0, 60), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    out.rowChildren = [...row.children].map((c) => ({
      cls: String(c.className || "").slice(0, 40),
      label: c.getAttribute && c.getAttribute("aria-label"),
      tag: c.tagName,
      text: String(c.textContent || "").slice(0, 30),
    }));
  }
  return JSON.stringify(out, null, 1);
})()
