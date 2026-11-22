(function () {
  var out = { vw: innerWidth, vh: innerHeight, imgs: [] };
  var imgs = document.querySelectorAll('[role="img"]');
  for (var i = 0; i < imgs.length; i++) {
    var el = imgs[i];
    var r = el.getBoundingClientRect();
    var chain = [];
    var p = el;
    for (var n = 0; n < 5 && p; n++) {
      chain.push(p.tagName + " kids=" + p.children.length + " txt=" + JSON.stringify(String(p.textContent || "").trim().slice(0, 18)));
      p = p.parentElement;
    }
    out.imgs.push({
      label: el.getAttribute("aria-label"),
      rect: [Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)],
      chain: chain,
    });
  }
  return JSON.stringify(out, null, 1);
})()
