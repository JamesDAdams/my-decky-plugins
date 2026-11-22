import { adopt, nodeFor, uiDocument, walkNodes } from "./navAdopt";
import { report } from "./report";
import { openScsk, SCSK_ICON_PATH, setActiveAppid } from "./ui/ScskButton";

/**
 * The SCSKiller button of a game page: one 48x48 icon left of the controller icon.
 *
 * Why it is a copy of a native icon and not a React element (measured on this client, AGENTS.md 3c):
 * Big Picture moves the gamepad focus through the navigation nodes Steam registers for its own
 * `Focusable` components, and a node built from scratch is not traversed. The icon row is itself a
 * focus group (`GetFocusable() = "children"`) whose children are registered nodes, so the button is
 * a *copy of the "Manage" icon* - same markup, same classes, same size - plus a copy of that icon's
 * navigation node, inserted at the front of the row. To the controller it is one more icon of the
 * row: same geometry, same focus handling, same focus ring.
 *
 * The insert runs from a keeper because the DOM element appears and disappears with Steam's own
 * rendering; the page it belongs to is identified by the route, never by a hard-coded id.
 */

const ROUTE_APP = /\/routes\/library\/app\/(\d+)/;
const CONTROLLER_LABEL = "Configure Controller";
const TEMPLATE_LABEL = "Manage";
const BUTTON_ATTR = "data-scskiller-button";
const DOT_ATTR = "data-scskiller-dot";

const CSS = `[${BUTTON_ATTR}]{position:relative;display:flex;align-items:center;justify-content:center;width:48px;height:48px;flex:0 0 auto;margin-right:10px;border-radius:2px;background:rgba(172,178,201,0.14);color:#e6e8ea;cursor:pointer;transition:background-color .12s ease}
[${BUTTON_ATTR}]:hover{background:rgba(205,213,226,0.26)}
[${BUTTON_ATTR}]:focus{background:#e6e8ea;color:#16191d;outline:none}
[${DOT_ATTR}]{position:absolute;right:4px;bottom:4px;width:9px;height:9px;border-radius:5px;border:1px solid rgba(0,0,0,0.55);background:#e05252;box-shadow:0 0 5px #e05252}`;

let timer: ReturnType<typeof setInterval> | undefined;
let ticks = 0;
let insertedOnce = false;
let nodeReported = false;
let focusReported = false;
let blurReported = false;
let styleInstalled = false;

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

/** The native icon this button is a copy of: the settings icon at the end of the row. */
function findTemplate(row: Element): Element | null {
  const inside = row.querySelector(`[aria-label="${TEMPLATE_LABEL}"]`);
  if (inside) return inside as Element;
  const children = Array.from(row.children);
  return children.length ? (children[children.length - 1] as Element) : null;
}

function createButton(doc: Document, row: Element): HTMLElement | null {
  const template = findTemplate(row);
  if (!template) return null;
  const button = template.cloneNode(true) as HTMLElement;
  button.setAttribute(BUTTON_ATTR, "1");
  button.setAttribute("aria-label", "SCSKiller");
  button.removeAttribute("id");
  button.removeAttribute("aria-labelledby");
  // the copied glyph is Steam's settings icon: replace it with ours, keep the native box
  while (button.firstChild) button.removeChild(button.firstChild);
  button.appendChild(makeIcon(doc));
  const dot = doc.createElement("span");
  dot.setAttribute(DOT_ATTR, "1");
  button.appendChild(dot);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openScsk();
  });
  button.addEventListener("focus", () => {
    if (focusReported) return;
    focusReported = true;
    report("game page: button took the controller focus");
  });
  button.addEventListener("blur", () => {
    if (blurReported) return;
    blurReported = true;
    report("game page: button released the focus");
  });
  row.insertBefore(button, row.firstChild);
  return button;
}

/** Give the button the navigation node of the native icon it copies, under the icon row. */
function registerNode(row: Element, button: Element): boolean {
  const rowNode = nodeFor(row);
  if (!rowNode) return false;
  if (nodeFor(button)) return true;
  let templateNode: any = null;
  walkNodes((node) => {
    const element = node.m_element;
    if (!element || element === button) return false;
    const label = typeof element.getAttribute === "function" ? element.getAttribute("aria-label") : null;
    if (label === TEMPLATE_LABEL && row.contains(element)) {
      templateNode = node;
      return true;
    }
    return false;
  });
  if (!templateNode) return false;
  const node = adopt(button, rowNode, templateNode);
  if (!node) return false;
  if (!nodeReported) {
    nodeReported = true;
    report("game page: button inserted in the icon row with its own navigation node");
  }
  return true;
}

function tick(): void {
  ticks += 1;
  try {
    const appid = appidFromRoute();
    if (!appid) return;
    setActiveAppid(appid);
    const doc = uiDocument();
    if (!doc) return;
    installStyle(doc);
    const controller = doc.querySelector(`[aria-label="${CONTROLLER_LABEL}"]`);
    const row = controller?.parentElement?.parentElement;
    if (!row) return;
    let button = row.querySelector(`[${BUTTON_ATTR}]`) as HTMLElement | null;
    if (!button) {
      button = createButton(doc, row);
      if (!button) return;
      if (!insertedOnce) {
        insertedOnce = true;
        report("game page: button drawn in the icon row");
      }
      registerNode(row, button);
      return;
    }
    // the node is stolen by Steam's re-render from time to time: put it back
    if (ticks % 4 === 0) registerNode(row, button);
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
