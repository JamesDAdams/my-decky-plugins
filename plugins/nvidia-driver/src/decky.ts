/**
 * Opens the Decky panel on this plugin's page.
 *
 * Decky keeps the selected QAM plugin in `DeckyPluginLoader.deckyState` (`_activePlugin`,
 * set through `setActivePlugin`), and Steam opens the side menu through the window store's
 * `MenuStore`. Measured on this client: `setActivePlugin("SCSKiller")` followed by
 * `OpenQuickAccessMenu(999)` leaves `GetQuickAccessTab() === 999`, `GetOpenSideMenu() === 2`
 * and the QAM document shows that plugin's panel instead of the plugin list.
 */
export function openDeckyPluginPage(name: string): boolean {
  const scope = window as unknown as Record<string, any>;
  let selected = false;
  try {
    const state = scope.DeckyPluginLoader?.deckyState;
    if (state?.setActivePlugin) {
      state.setActivePlugin(name);
      selected = true;
    }
  } catch {
    selected = false;
  }
  const menu = scope.SteamUIStore?.m_WindowStore?.GamepadUIMainWindowInstance?.m_MenuStore;
  try {
    if (menu?.OpenQuickAccessMenu) {
      menu.OpenQuickAccessMenu(999);
      return true;
    }
  } catch {
    // fall through: reporting "false" lets the caller log it
  }
  return selected;
}
