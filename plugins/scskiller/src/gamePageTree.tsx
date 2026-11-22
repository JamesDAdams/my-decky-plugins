import { adopt, nodeFor, uiDocument, walkNodes } from "./navAdopt";
import { report } from "./report";
import { openScsk, SCSK_ICON_PATH, setActiveAppid } from "./ui/ScskButton";

/**
 * The SCSKiller button of a game page: one 48x48 icon left of the controller icon, reachable with
 * the controller.
 *
 * Two hard rules, both measured on this client (AGENTS.md 3c/3d):
 *
 * 1. **Never insert markup into a row Steam renders.** The icon row is a React child list: adding a
 *    node to it makes the next reconciliation of Steam's tree move or drop elements, and the row
 *    stops being reachable as a whole (observed: after such an insert, none of the three icons of
 *    the row could be focused from Play). The button is therefore drawn in its own fixed layer
 *    appended to `document.body`, never inside Steam's containers.
 * 2. **The controller reaches a control through its navigation node.** The node is a copy of the
 *    *Play* button's node (a real action: activation dispatches a click) reparented under the icon
 *    row, which is where the button is drawn. Nothing is written into the row's own node list, so
 *    the native icons keep the navigation they had.
 *
 * The geometry follows the controller icon every 400 ms, so the button stays exactly left of it at
 * any window size and follows a layout change.
 */

const ROUTE_APP = /\/routes\/library\/app\/(\d+)/;
const CONTROLLER_LABEL = "Configure Controller";
const BUTTON_ATTR = "data-scskiller-button";
const DOT_ATTR = "data-scskiller-dot";
const LAYER_ATTR = "data-scskiller-layer";

const WIDTH = 48;
const GAP = 10;

const CSS = `[${LAYER_ATTR}]{position:fixed;inset:0;pointer-events:none;z-index:40}
[${BUTTON_ATTR}]{position:absolute;display:flex;align-items:center;justify-content:center;width:${WIDTH}px;height:${WIDTH}px;pointer-events:auto;border-radius:2px;background:rgba(172,178,201,0.14);color:#e6e8ea;cursor:pointer;transition:background-color .12s ease}
[${BUTTON_ATTR}]:hover{background:rgba(205,213,226,0.26)}
[${BUTTON_ATTR}]:focus{background:#e6e8ea;color:#16191d;outline:none}
[${DOT_ATTR}]{position:absolute;right:4px;bottom:4px;width:9px;height:9px;border-radius:5px;border:1px solid rgba(0,0,0,0.55);background:#e05252;box-shadow:0 0 5px #e05252}`;

let timer: ReturnType<typeof setInterval> | undefined;
let ticks = 0;
let styleInstalled = false;
let insertedReported = false;
let nodeReported = false;
let focusLogCount = 0;
let focusWatching = false;

function appidFromRoute(): number {
  const match = ROUTE_APP.exec(String(location.pathname));
  return match ? Number(match[1]) : 0;
}

function installStyle(doc: Document): void {
  if (styleInstalled) return;
  try {
    const style = doc.createElement("style");
    style.textContent = CSS;
    (doc.head ?? doc.documentElement).appendChild(style);
    styleInstalled = true;
  } catch {
    // a document without head: the button keeps Steam's own colours
  }
}

function makeIcon(doc: Document): Element {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", SCSK_ICON_PATH);
  svg.appendChild(path);
  return svg;
}

/** The document the controller is currently drawing in: the one that holds Steam's icon row. */
function bigPictureDocument(): Document | null {
  const doc = uiDocument();
  if (doc) return doc;
  return null;
}

function layerFor(doc: Document): HTMLElement | null {
  let layer = doc.querySelector(`[${LAYER_ATTR}]`) as HTMLElement | null;
  if (layer) return layer;
  try {
    layer = doc.createElement("div");
    layer.setAttribute(LAYER_ATTR, "1");
    doc.body.appendChild(layer);
    return layer;
  } catch {
    return null;
  }
}

function createButton(doc: Document, layer: HTMLElement): HTMLElement {
  const button = doc.createElement("div");
  button.setAttribute(BUTTON_ATTR, "1");
  button.setAttribute("aria-label", "SCSKiller");
  button.setAttribute("role", "button");
  button.setAttribute("tabindex", "0");
  button.appendChild(makeIcon(doc));
  const dot = doc.createElement("span");
  dot.setAttribute(DOT_ATTR, "1");
  button.appendChild(dot);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openScsk();
  });
  button.addEventListener("focus", () => report("game page: button took the focus"));
  layer.appendChild(button);
  return button;
}

/**
 * Follow the controller icon: the button sits `GAP` px left of it, same size, same top. Everything
 * comes from one `getBoundingClientRect()` of the native icon, so a window resize or a layout
 * change is followed without knowing any offset.
 */
function place(button: HTMLElement, controller: Element): boolean {
  const box = controller.getBoundingClientRect();
  if (!box.width || !box.height) return false;
  // the controller icon is centred in a wrapper ~10 px wider than the glyph
  const wrapper = (controller.parentElement && controller.parentElement.getBoundingClientRect()) || box;
  const left = Math.round(wrapper.left - GAP - WIDTH);
  const top = Math.round(box.top + (box.height - WIDTH) / 2);
  if (button.style.left !== `${left}px`) button.style.left = `${left}px`;
  if (button.style.top !== `${top}px`) button.style.top = `${top}px`;
  return true;
}

/** Copy the Play button's node: it is a real action node, and its click activation is what we want. */
function playNode(): any {
  let found: any = null;
  const manager = (window as any).SteamUIStore?.NavigationManager;
  const context = manager?.m_ActiveContext;
  const trees: any[] = context ? Array.from(context.m_rgGamepadNavigationTrees ?? []) : [];
  for (const tree of trees) {
    const stack: any[] = [tree?.m_Root];
    let steps = 0;
    while (stack.length && !found && steps < 20000) {
      const node: any = stack.pop();
      steps += 1;
      if (!node || typeof node !== "object") continue;
      const element = node.m_element;
      if (element && element.nodeType === 1 && String(element.textContent || "").trim() === "Play") {
        const parent = node.m_Parent;
        const inBar = parent?.m_element && String(parent.m_element.className || "").indexOf("_2Gj21aHb") >= 0;
        if (inBar) {
          found = node;
          break;
        }
      }
      for (const child of node.m_rgChildren ?? []) stack.push(child);
    }
    if (found) break;
  }
  return found;
}

function registerNode(row: Element, button: Element): boolean {
  const rowNode = nodeFor(row);
  if (!rowNode) return false;
  if (nodeFor(button)) return true;
  // the closest sibling of the button: the settings icon of the same row (same kind of node)
  let template: any = null;
  for (const child of rowNode.m_rgChildren ?? []) {
    const element = child?.m_element;
    if (element && typeof element.getAttribute === "function" && element.getAttribute("aria-label") === "Manage") {
      template = child;
      break;
    }
  }
  if (!template) template = playNode();
  if (!template) return false;
  const node = adopt(button, rowNode, template);
  if (!node) return false;
  if (!nodeReported) {
    nodeReported = true;
    report(`game page: button registered in the icon row focus group (${String(node.GetFocusable())})`);
  }
  return true;
}

/**
 * Log where the controller focus goes. The D-pad cannot be simulated on this build (measured), so a
 * real controller test is the only source of truth; these lines make it readable afterwards.
 */
function watchFocus(doc: Document): void {
  if (focusWatching) return;
  focusWatching = true;
  try {
    doc.addEventListener(
      "focusin",
      (event) => {
        if (focusLogCount >= 40) return;
        focusLogCount += 1;
        const target = event.target as HTMLElement | null;
        if (!target || typeof target.getAttribute !== "function") return;
        const label = target.getAttribute("aria-label") ?? "";
        const text = String(target.textContent || "").trim().slice(0, 24);
        const own = target.hasAttribute(BUTTON_ATTR) ? " SCSKILLER" : "";
        report(`focus: ${String(target.className || "").slice(0, 28)} label="${label}" text="${text}"${own}`);
      },
      true,
    );
  } catch {
    // no focus log on this build
  }
}

function tick(): void {
  ticks += 1;
  try {
    const appid = appidFromRoute();
    if (!appid) return;
    setActiveAppid(appid);
    const doc = bigPictureDocument();
    if (!doc) return;
    installStyle(doc);
    watchFocus(doc);
    const controller = doc.querySelector(`[aria-label="${CONTROLLER_LABEL}"]`);
    const row = controller?.parentElement?.parentElement;
    if (!row || !controller) return;
    const layer = layerFor(doc);
    if (!layer) return;
    let button = layer.querySelector(`[${BUTTON_ATTR}]`) as HTMLElement | null;
    if (!button) {
      button = createButton(doc, layer);
      if (!insertedReported) {
        insertedReported = true;
        report("game page: button drawn over the icon row");
      }
    }
    if (!place(button, controller)) return;
    if (ticks % 4 === 1) registerNode(row, button);
  } catch (exc: unknown) {
    report(`game page: ${String(exc)}`);
  }
}

export function installGamePageButton(): () => void {
  if (timer) return () => undefined;
  ticks = 0;
  timer = setInterval(tick, 400);
  tick();
  return () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
}
