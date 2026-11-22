(function () {
  var el = document.getElementById("decky-qam-hint");
  if (!el) return JSON.stringify({ present: false });
  var row = el.parentElement;
  var kids = Array.prototype.slice.call(row.children).map(function (c) {
    var r = c.getBoundingClientRect();
    return {
      id: c.id || null,
      text: String(c.textContent || "").trim().slice(0, 16),
      rect: [Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)],
    };
  });
  var r = el.getBoundingClientRect();
  var cs = getComputedStyle(el);
  return JSON.stringify(
    {
      present: true,
      text: el.textContent,
      rect: [Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)],
      display: cs.display,
      gapAfter: kids.map(function (k) { return k.text; }),
      kids: kids,
    },
    null,
    1,
  );
})()
