// Open Big Picture's main menu (the Home / Library / Store rail).
//
// OpenMainMenu() alone does nothing while another side menu (the QAM) is open: the QAM keeps the
// active focus tree, so the rail nodes stay unreachable and a D-pad press moves nothing
// (measured 2026-11-22: GetOpenSideMenu() still answered 1 = quick access).
//
// Usage: node ../tools/cdp.mjs SharedJSContext open-main-menu.js
(async () => {
  const store = window.SteamUIStore;
  const instance =
    (store.GetFocusedWindowInstance && store.GetFocusedWindowInstance()) ||
    (store.WindowStore && store.WindowStore.GamepadUIMainWindowInstance);
  const menu = instance && instance.MenuStore;
  if (!menu) return "no MenuStore";
  try {
    menu.CloseSideMenus();
  } catch (error) {
    // nothing open
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    menu.OpenMainMenu();
  } catch (error) {
    return "throws " + String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return "main menu open: side=" + String(menu.GetOpenSideMenu && menu.GetOpenSideMenu()) + " visible=" + String(menu.IsAnySideMenuVisible());
})()
