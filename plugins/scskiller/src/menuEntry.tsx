import { findInReactTree } from "@decky/ui";
import { report } from "./api";

/** react-router is not a dependency of a Decky plugin: the route object is opaque to us. */
type RouteProps = any;

/**
 * Add an SCSKiller entry to Big Picture's left menu (the Home / Library / Store list), right
 * under Downloads. The list is a `pages` array handed to Steam's sidebar component, so the
 * entry is a React node in that array - clicking it goes through Steam's own router, which is
 * also why the page needs `routerHook.addRoute` and nothing else.
 *
 * Everything is defensive: if Steam changes the shape, we log what we saw and add nothing.
 */

export const MENU_ROUTE = "/scskiller";

const MenuIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
    <path d="M13 2 4.5 13.2c-.4.5 0 1.3.6 1.3H10l-1 7.5L19.5 10c.4-.5 0-1.3-.6-1.3H14l1-6.7Z" />
  </svg>
);

let reported = false;

type PageLike = { title?: unknown; route?: unknown; [key: string]: unknown };

function describe(pages: PageLike[]): string {
  return pages
    .slice(0, 14)
    .map((page) =>
      (page as any) === "separator"
        ? "|"
        : `${String(page?.title ?? "?")}=${String(page?.route ?? page?.link ?? "-")}`,
    )
    .join(" ");
}

export function addMenuEntry(route: RouteProps): RouteProps {
  try {
    const host = findInReactTree(route, (node) => {
      const pages = (node as any)?.props?.pages;
      return Array.isArray(pages) && pages.length >= 3;
    }) as any;
    if (!host) {
      if (!reported) {
        reported = true;
        report("menu: no pages array in the root route");
      }
      return route;
    }
    const pages = host.props.pages as PageLike[];
    const existing = pages.some((page) => page && typeof page === "object" && page.route === MENU_ROUTE);
    if (!existing) {
      const index = pages.findIndex((page) => typeof (page as any)?.route === "string" && /download/i.test(String((page as any).route)));
      // Steam's sidebar only wires the gamepad focus of the entries it builds from its own page
      // objects: a hand-made object renders (icon + title) but never receives focus. Cloning the
      // native Downloads entry keeps every field Steam expects and only overrides what differs.
      const base = (index >= 0 ? pages[index] : pages[0]) as PageLike;
      const entry: PageLike = { ...base, title: "SCSKiller", route: MENU_ROUTE, icon: <MenuIcon />, content: null };
      delete (entry as any).link;
      delete (entry as any).onSelected;
      pages.splice(index >= 0 ? index + 1 : pages.length, 0, entry);
      report(
        `menu: entry added after ${index >= 0 ? "downloads" : "the last page"} (base keys: ${Object.keys(base ?? {}).join(",")}) - pages: ${describe(pages)}`,
      );
    }
  } catch (exc) {
    report(`menu: ${String(exc)}`);
  }
  return route;
}
