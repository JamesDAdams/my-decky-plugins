(function () {
  var out = { vw: innerWidth, vh: innerHeight, leaves: [] };
  var all = document.querySelectorAll("div,span,button,kbd");
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.children.length) continue;
    var t = (el.textContent || "").trim();
    if (!t || t.length > 40) continue;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.top < innerHeight * 0.8) continue;
    out.leaves.push({
      text: t,
      tag: el.tagName,
      cls: String(el.className || "").slice(0, 60),
      rect: [Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)],
      parentCls: el.parentElement ? String(el.parentElement.className || "").slice(0, 60) : null,
      gpCls: el.parentElement && el.parentElement.parentElement ? String(el.parentElement.parentElement.className || "").slice(0, 60) : null,
    });
  }
  out.count = out.leaves.length;
  return JSON.stringify(out, null, 1);
})()
