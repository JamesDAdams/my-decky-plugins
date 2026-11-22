/**
 * Best-effort wrappers around Steam's own UI store.
 *
 * Everything below is internal to the Steam client. The names come from
 * @decky/ui's typings (globals/stores/steamuistore), but Valve is free to move
 * them in any client update, so every helper returns a safe fallback instead of
 * throwing. Callers must treat `false` / `undefined` / `UNKNOWN` as "cannot
 * tell", never as "definitely not".
 */
import { Navigation, Router } from "@decky/ui";

/** Steam's EUIMode.GamePad (globals/shared/enums). */
export const UI_MODE_GAMEPAD = 4;
/** Steam's EUIMode.Desktop. */
export const UI_MODE_DESKTOP = 7;
/** Steam's EUIMode.Unknown - "the client has not decided yet". */
export const UI_MODE_UNKNOWN = -1;

/** Steam's ENavigationSourceType (globals/shared/navigation). */
export const NAV_SOURCE = {
  UNKNOWN: 0,
  GAMEPAD: 1,
  KEYBOARD_SIMULATOR: 2,
  MOUSE: 3,
  TOUCH: 4,
  LPAD: 5,
  RPAD: 6,
} as const;

/** Steam's SideMenu enum (globals/stores/steamuistore/menu). */
export const SIDE_MENU = {
  NONE: 0,
  MAIN: 1,
  QUICK_ACCESS: 2,
} as const;

/**
 * Id of Decky's own tab inside the Quick Access Menu
 * (globals/stores/steamuistore/menu.ts: `QuickAccessTab.Decky = 999`).
 * Spelled out instead of imported so a missing export can never throw here.
 */
export const DECKY_QAM_TAB = 999;

/** The client's UI store, whenever we can reach it. */
function steamStore(): any {
  try {
    return (Router as any) ?? (window as any).SteamUIStore;
  } catch {
    return undefined;
  }
}

/** MenuStore of the focused Big Picture window, when there is one. */
export function menuStore(): any {
  try {
    const store = steamStore();
    const instance =
      store?.GetFocusedWindowInstance?.() ??
      store?.WindowStore?.GamepadUIMainWindowInstance;
    return instance?.MenuStore ?? undefined;
  } catch {
    return undefined;
  }
}

/** Raw UI mode reported by Steam, if the getter still exists. */
export function getUiMode(): number | undefined {
  try {
    const store = steamStore();
    const mode = store?.MainInstancUIMode ?? store?.m_mainInstancUIMode;
    return typeof mode === "number" ? mode : undefined;
  } catch {
    return undefined;
  }
}

/**
 * True unless the client clearly says it is in desktop mode.
 *
 * Deliberately permissive: the previous version also consulted
 * `IsGamepadUIWindowActive()`, which returns false on desktop Steam even while
 * Big Picture is open (Big Picture reuses the main window there), and that
 * silently disabled the whole plugin. Only an explicit Desktop mode turns it
 * off now; anything unknown counts as Big Picture.
 */
export function isGamepadUIMode(): boolean {
  const mode = getUiMode();
  if (typeof mode === "number" && mode !== UI_MODE_UNKNOWN) {
    return mode !== UI_MODE_DESKTOP;
  }
  return true;
}

/** True when the Quick Access Menu itself is the menu on screen. */
export function isQuickAccessOpen(): boolean {
  try {
    const menu = menuStore();
    if (typeof menu?.GetOpenSideMenu === "function") {
      return menu.GetOpenSideMenu() === SIDE_MENU.QUICK_ACCESS;
    }
    if (typeof menu?.IsSideMenuVisible === "function") {
      return !!menu.IsSideMenuVisible(SIDE_MENU.QUICK_ACCESS);
    }
    if (typeof menu?.IsAnySideMenuVisible === "function") {
      return !!menu.IsAnySideMenuVisible();
    }
  } catch {
    /* fall through */
  }
  return false;
}

/** True when any side menu (Quick Access Menu or main menu) is on screen. */
export function isAnySideMenuVisible(): boolean {
  try {
    const menu = menuStore();
    if (typeof menu?.IsAnySideMenuVisible === "function") {
      return !!menu.IsAnySideMenuVisible();
    }
    if (typeof menu?.GetOpenSideMenu === "function") {
      return menu.GetOpenSideMenu() !== SIDE_MENU.NONE;
    }
  } catch {
    /* fall through */
  }
  return false;
}

/** Tab currently selected in the Quick Access Menu, if known. */
export function getQuickAccessTab(): number | undefined {
  try {
    const tab = menuStore()?.GetQuickAccessTab?.();
    return typeof tab === "number" ? tab : undefined;
  } catch {
    return undefined;
  }
}

/** Closes the Quick Access Menu only (never the main menu). */
export function closeQuickAccess(): boolean {
  try {
    const menu = menuStore();
    if (typeof menu?.ToggleSideMenu === "function") {
      // The QAM is open, so toggling the Quick Access side menu closes it.
      menu.ToggleSideMenu(SIDE_MENU.QUICK_ACCESS);
      return true;
    }
    if (typeof menu?.CloseSideMenus === "function") {
      menu.CloseSideMenus();
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    (window as any).SteamUIStore?.CloseSideMenus?.();
    return true;
  } catch {
    return false;
  }
}

/** The last input device that drove the UI (see NAV_SOURCE). */
export function getNavigationSourceType(): number {
  try {
    const store = steamStore();
    const fromController = store?.NavigationManager?.GetSourceType?.();
    if (typeof fromController === "number") return fromController;
    const raw = store?.m_navigationSource?.eActivationSourceType;
    if (typeof raw === "number") return raw;
    const sourceType = store?.ActiveNavigationSourceType;
    if (typeof sourceType === "number") return sourceType;
  } catch {
    /* fall through */
  }
  return NAV_SOURCE.UNKNOWN;
}

/**
 * Opens Decky's tab of the Quick Access Menu: the panel that slides in from the
 * right of Big Picture.
 *
 * Returns true only when a real function could be called (Steam's own helpers
 * swallow their errors, so `true` means "requested", not "verified").
 */
export function openDeckyPanel(): boolean {
  // 1. Talk to the focused window's menu store directly (synchronous, closest
  //    to what the QAM button itself does).
  try {
    const menu = menuStore();
    if (typeof menu?.OpenQuickAccessMenu === "function") {
      menu.OpenQuickAccessMenu(DECKY_QAM_TAB);
      scheduleOpenFallback();
      return true;
    }
  } catch {
    /* try the next strategy */
  }

  // 2. Decky's Navigation helper, which finds the focused window for us.
  try {
    const navigation = Navigation as any;
    if (typeof navigation?.OpenQuickAccessMenu === "function") {
      navigation.OpenQuickAccessMenu(DECKY_QAM_TAB);
      scheduleOpenFallback();
      return true;
    }
  } catch {
    /* give up */
  }

  return false;
}

/** Resolves true as soon as the Quick Access Menu shows up, false on timeout. */
export function waitForQuickAccess(timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (isQuickAccessOpen() || isAnySideMenuVisible()) {
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }
      window.setTimeout(tick, 60);
    };
    tick();
  });
}

let fallbackTimer: number | undefined;

/** Cancels a pending "reopen the QAM anyway" retry. */
export function cancelOpenFallback(): void {
  if (fallbackTimer !== undefined) {
    window.clearTimeout(fallbackTimer);
    fallbackTimer = undefined;
  }
}

/**
 * Some client builds ignore an unknown tab id and simply never show the QAM.
 * If nothing is visible shortly after the request, reopen the QAM on whatever
 * tab it remembers so the shortcut still does something useful.
 */
function scheduleOpenFallback(): void {
  cancelOpenFallback();
  fallbackTimer = window.setTimeout(() => {
    fallbackTimer = undefined;
    try {
      if (isAnySideMenuVisible()) return;
      const navigation = Navigation as any;
      if (typeof navigation?.OpenQuickAccessMenu === "function") {
        navigation.OpenQuickAccessMenu();
      }
    } catch {
      /* nothing else we can do */
    }
  }, 450);
}
