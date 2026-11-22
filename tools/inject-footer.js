(function () {
  var ID = "decky-qam-hint";
  var out = {};

  function findItem() {
    var imgs = document.querySelectorAll('[role="img"]');
    var best = null;
    for (var i = 0; i < imgs.length; i++) {
      var el = imgs[i];
      var r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6 || r.top < window.innerHeight * 0.8) continue;
      var p = el.parentElement;
      for (var depth = 0; depth < 5 && p; depth++) {
        var parent = p.parentElement;
        if (p.children.length === 2 && parent && parent.children.length >= 2) {
          best = p;
          break;
        }
        p = parent;
      }
    }
    return best;
  }

  var item = findItem();
  if (!item) return JSON.stringify({ ok: false, reason: "no-footer-item" });

  var old = document.getElementById(ID);
  if (old) old.remove();

  var clone = item.cloneNode(true);
  clone.id = ID;
  clone.setAttribute("role", "button");
  clone.setAttribute("tabindex", "-1");
  clone.setAttribute("aria-label", "Ouvrir le panneau Decky (Ctrl+2)");
  clone.title = "Ouvrir le panneau Decky (Ctrl+2)";

  var cap = clone.querySelector('[role="img"]');
  if (cap) {
    cap.setAttribute("aria-label", "Ctrl+2");
    var capText = cap.querySelector('[aria-hidden="true"] > div') || cap.querySelector("div");
    if (capText) capText.textContent = "Ctrl+2";
  }
  var labelEl = clone.children[1];
  if (labelEl) labelEl.textContent = "DECKY";

  var row = item.parentElement;
  var kids = Array.prototype.slice.call(row.children);
  var spacer = -1;
  for (var k = 0; k < kids.length; k++) {
    if ((kids[k].textContent || "").trim() === "") {
      spacer = k;
      break;
    }
  }
  var before = spacer >= 0 ? kids[spacer + 1] : null;
  if (!before) before = kids[kids.length - 1];
  row.insertBefore(clone, before);

  var rect = clone.getBoundingClientRect();
  var nativeRect = item.getBoundingClientRect();
  out.ok = true;
  out.rect = [Math.round(rect.width), Math.round(rect.height), Math.round(rect.left), Math.round(rect.top)];
  out.native = [Math.round(nativeRect.width), Math.round(nativeRect.height), Math.round(nativeRect.left), Math.round(nativeRect.top)];
  out.spacer = spacer;
  out.rowKids = kids.map(function (c) {
    return String(c.textContent || "").trim().slice(0, 14);
  });
  out.text = clone.textContent;
  out.capText = cap ? cap.textContent : null;
  return JSON.stringify(out, null, 1);
})()
