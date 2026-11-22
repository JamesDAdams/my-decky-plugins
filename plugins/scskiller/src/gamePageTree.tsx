import { routerHook } from "@decky/api";
import { afterPatch, appDetailsClasses, createReactTreePatcher, findInReactTree } from "@decky/ui";
import type { Patch } from "@decky/ui";
import type { ReactElement } from "react";
import { diagnostics } from "./diagnostics";
import { report } from "./report";
import { ScskButton, setActiveAppid } from "./ui/ScskButton";

/**
 * The compact SCSKiller button sits on Steam's play bar, immediately left of the controller icon.
 *
 * It is a **single, module-level element**: the route patch inserts the same React element on
 * every render, so React keeps the component mounted. That matters more than it looks - an
 * unmounting `Focusable` unregisters its gamepad navigation node, and a freshly registered node
 * lands under the page container instead of the icon row. The keeper in `gamepadFix.ts` then only
 * has to move that one node once into the icon row (see AGENTS.md section 3c).
 */

const ROUTE = "/library/app/:appid";
const BUTTON_KEY = "scskiller-button";

// Offsets from the right edge of the page content, and from the top of the play bar.
const OFFSET_RIGHT = 152;
const OFFSET_TOP = 16;

let inner: Patch | undefined;
let routePatch: any;
let layoutReported = false;

/** Built once: same element identity on every render, so React never remounts the button. */
const OVERLAY = (
  <div
    key={BUTTON_KEY}
    data-scskiller="overlay"
    style={{ position: "relative", height: 0, width: "100%", zIndex: 10 }}
  >
    <div style={{ position: "absolute", right: OFFSET_RIGHT, top: OFFSET_TOP }}>
      <ScskButton />
    </div>
  </div>
);

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
                  // the button reads this on every render (it is mounted once)
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
                  if (!children.some((child: any) => child?.key === BUTTON_KEY)) {
                    // between the artwork header and the play bar, at zero height, so the button
                    // overflows onto the bar without moving anything
                    children.splice(Math.min(1, children.length), 0, OVERLAY);
                  }
                  diagnostics.injected = true;
                  diagnostics.appid = appid;
                  diagnostics.detail = `app ${appid}: on the play bar (gamepad: icon row)`;
                  return ret;
                } catch (exc: unknown) {
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
