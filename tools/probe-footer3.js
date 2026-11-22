(function () {
  function findLeaf(txt) {
    var all = document.querySelectorAll("div,span");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children.length) continue;
      if ((el.textContent || "").trim() === txt && el.getBoundingClientRect().top > innerHeight * 0.8) return el;
    }
    return null;
  }
  function chain(el, n) {
    var r = [];
    while (el && r.length < n) {
      r.push(
        el.tagName +
          "." +
          String(el.className || "").slice(0, 55) +
          " kids=" +
          el.children.length +
          " txt=" +
          JSON.stringify(String(el.textContent || "").trim().slice(0, 24)),
      );
      el = el.parentElement;
    }
    return r;
  }
  function commonAncestor(a, b) {
    var set = new Set();
    while (a) {
      set.add(a);
      a = a.parentElement;
    }
    while (b) {
      if (set.has(b)) return b;
      b = b.parentElement;
    }
    return null;
  }
  var out = {};
  var key = findLeaf("Esc");
  var lab = findLeaf("Back");
  out.keyChain = key ? chain(key, 6) : null;
  out.labChain = lab ? chain(lab, 6) : null;
  var item = key && lab ? commonAncestor(key, lab) : null;
  if (item) {
    out.itemHtml = item.outerHTML.slice(0, 1600);
    var group = item.parentElement;
    out.groupCls = group ? String(group.className || "") : null;
    out.groupKids = group ? Array.prototype.map.call(group.children, function (c) { return String(c.textContent || "").trim().slice(0, 20); }) : null;
    out.groupRect = group
      ? (function () {
          var r = group.getBoundingClientRect();
          return [Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)];
        })()
      : null;
  }
  return JSON.stringify(out, null, 1);
})()
