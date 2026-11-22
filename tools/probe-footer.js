(function () {
  var out = {};
  var all = document.querySelectorAll("div,span");
  var label = null;
  var keycap = null;
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.children.length) continue;
    var t = (el.textContent || "").trim();
    if (t === "OPTIONS") label = el;
    if (t === "F9") keycap = el;
  }
  function chain(el, n) {
    var r = [];
    while (el && r.length < n) {
      r.push(el.tagName + "." + String(el.className || "").slice(0, 80));
      el = el.parentElement;
    }
    return r;
  }
  out.labelChain = label ? chain(label, 5) : null;
  out.keyChain = keycap ? chain(keycap, 5) : null;
  var item = label && label.parentElement && label.parentElement.parentElement;
  out.itemHTML = item ? item.outerHTML.slice(0, 900) : null;
  var row = item && item.parentElement;
  if (row) {
    out.rowClasses = String(row.className || "");
    out.rowChildren = Array.prototype.map.call(row.children, function (c) {
      return (c.textContent || "").trim().slice(0, 30);
    });
    out.rowRect = (function () {
      var r = row.getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)];
    })();
  }
  if (keycap && label) {
    var cs = getComputedStyle(keycap);
    var ls = getComputedStyle(label);
    out.keyStyle = {
      color: cs.color,
      bg: cs.backgroundColor,
      size: cs.fontSize,
      family: cs.fontFamily.slice(0, 60),
      weight: cs.fontWeight,
      radius: cs.borderRadius,
      pad: cs.padding,
      height: cs.height,
      minWidth: cs.minWidth,
      shadow: String(cs.boxShadow).slice(0, 90),
    };
    out.labelStyle = {
      color: ls.color,
      size: ls.fontSize,
      family: ls.fontFamily.slice(0, 60),
      weight: ls.fontWeight,
      letter: ls.letterSpacing,
    };
    out.itemRect = (function () {
      var r = (label.parentElement.parentElement || label).getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)];
    })();
  }
  return JSON.stringify(out, null, 1);
})()
