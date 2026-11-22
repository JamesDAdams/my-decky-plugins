import { routerHook } from "@decky/api";
import { afterPatch, appDetailsClasses, createReactTreePatcher, findInReactTree } from "@decky/ui";
import type { Patch } from "@decky/ui";
import type { ReactElement } from "react";
import { diagnostics } from "./diagnostics";
import { report } from "./report";
import { ScskButton, setActiveAppid } from "./ui/ScskButton";

/**
 * Insert the button just above Steam's play bar, anchored to the right so it lands
 * immediately left of the controller icon (which sits at the right end of that bar).
 *
 * The plugin runs in Steam's shared JS context (a 1x1 page), so the visible DOM is
 * out of reach: only the shared React route tree can be patched. The play bar is the
 * second child of the app page's content column (the first is the artwork header).
 */

const ROUTE = "/library/app/:appid";
const BUTTON_KEY = "scskiller-button";

// Offsets from the right edge of the page content, and from the top of the play bar.
const OFFSET_RIGHT = 152;
const OFFSET_TOP = 16;

let inner: Patch | undefined;
let routePatch: any;
let layoutReported = false;

function readAppId(overview: any): number {
  const raw = overview?.appid ?? overview?.app_id;
  const appid = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(appid) ? appid : 0;
}

export function installGamePageButton(): () => void {
  if (routePatch) return () => undefined;

  try {
    routePatch = routerHook.addPatch(ROUTE, (tree: any) => {
      try {
        if (!inner) {
          const routeProps = findInReactTree(tree, (node: any) => node?.renderFunc);
          if (routeProps) {
            let appid = 0;
            const handler = createReactTreePatcher(
              [
                (node: any) => {
                  const host = findInReactTree(node, (entry: any) => entry?.props?.children?.props?.overview);
                  appid = readAppId(host?.props?.children?.props?.overview);
                  return host?.props?.children;
                },
              ],
              (_args: any[], ret: ReactElement) => {
                try {
                  if (!appid) return ret;
                  setActiveAppid(appid);
                  const container = findInReactTree(
                    ret,
                    (node: any) =>
                      Array.isArray(node?.props?.children) &&
                      typeof node?.props?.className === "string" &&
                      node.props.className.includes(appDetailsClasses.InnerContainer),
                  );
                  const children = container?.props?.children;
                  if (!Array.isArray(children)) {
                    diagnostics.injected = false;
                    diagnostics.detail = `app ${appid}: no content container`;
                    report(`game page: ${diagnostics.detail}`);
                    return ret;
                  }
                  if (children.some((child: any) => child?.key === BUTTON_KEY)) {
                    diagnostics.injected = true;
                    return ret;
                  }

                  // index 0 is the artwork header, index 1 the play bar: sit between
                  // them, at zero height, and let the button overflow onto the bar
                  children.splice(
                    Math.min(1, children.length),
                    0,
                    <div
                      key={BUTTON_KEY}
                      data-scskiller="overlay"
                      style={{ position: "relative", height: 0, width: "100%", zIndex: 10 }}
                    >
                      <div style={{ position: "absolute", right: OFFSET_RIGHT, top: OFFSET_TOP }}>
                        <ScskButton />
                      </div>
                      {/* the Play button is replaced by a Pause overlay by the top-bar injector */}
                    </div>,
                  );
                  diagnostics.injected = true;
                  diagnostics.appid = appid;
                  diagnostics.detail = `app ${appid}: right ${OFFSET_RIGHT} / below header`;
                } catch (exc: unknown) {
                  // a different Steam layout: leave the page alone, but say so once in the log
                  if (!layoutReported) {
                    layoutReported = true;
                    report(`game page: patch failed (${String(exc)})`);
                  }
                }
                return ret;
              },
            );
            inner = afterPatch(routeProps, "renderFunc", handler);
          }
        }
      } catch {
        // route patching unavailable
      }
      return tree;
    });
  } catch {
    report("game page: route patching unavailable");
    return () => undefined;
  }

  return () => {
    try {
      inner?.unpatch();
    } catch {}
    try {
      if (routePatch) routerHook.removePatch(ROUTE, routePatch);
    } catch {}
    inner = undefined;
    routePatch = null;
  };
}
