(function () {
  var el = document.getElementById("decky-qam-hint");
  if (!el) return "missing";
  var before = window.__DECKY_HINT_REQ__ | 0;
  el.click();
  var afterClick = window.__DECKY_HINT_REQ__ | 0;
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "2", code: "Digit2", ctrlKey: true, bubbles: true, cancelable: true }),
  );
  var afterKey = window.__DECKY_HINT_REQ__ | 0;
  return JSON.stringify({ before: before, afterClick: afterClick, afterKey: afterKey });
})()
