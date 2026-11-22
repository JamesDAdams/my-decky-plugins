// What can open/close Big Picture's side menus, and is one open now?
(() => {
  const store = window.SteamUIStore;
  const instance =
    (store.GetFocusedWindowInstance && store.GetFocusedWindowInstance()) ||
    (store.WindowStore && store.WindowStore.GamepadUIMainWindowInstance);
  const menu = instance && instance.MenuStore;
  if (!menu) return "no MenuStore";
  const proto = Object.getPrototypeOf(menu);
  const methods = [];
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (/menu|side|open|close|toggle|nav/i.test(key)) methods.push(key);
  }
  const state = {};
  for (const key of ["GetQuickAccessTab", "IsAnySideMenuVisible", "GetSideMenu", "m_bOpen", "m_sideMenu"]) {
    try {
      const value = typeof menu[key] === "function" ? menu[key]() : menu[key];
      state[key] = typeof value === "object" ? String(value) : value;
    } catch (error) {
      state[key] = "throws";
    }
  }
  return JSON.stringify({ methods, state, visible: itemOf() }, null, 1);

  function itemOf() {
    try {
      return String(menu.IsAnySideMenuVisible());
    } catch (error) {
      return "?";
    }
  }
})()
