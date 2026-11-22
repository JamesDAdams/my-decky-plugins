(function () {
  var el = document.getElementById("decky-qam-hint");
  if (!el) return JSON.stringify({ present: false });
  var r = el.getBoundingClientRect();
  var cs = getComputedStyle(el);
  return JSON.stringify({
    present: true,
    text: el.textContent,
    rect: [Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)],
    display: cs.display,
    opacity: cs.opacity,
    connected: el.isConnected,
    parentKids: el.parentElement ? el.parentElement.children.length : -1,
  });
})()
