import { adopt, nodeFor, uiDocument } from "./navAdopt";
import { report } from "./report";
import { openScsk, SCSK_ICON_PATH, setActiveAppid } from "./ui/ScskButton";

/**
 * The SCSKiller button of a game page: one 48x48 icon left of the controller icon.
 *
 * The button **is** a native icon of the row: the `Manage` icon is cloned (same element, same
 * classes, same box) and inserted as the row's first child, so it takes the same place, the same
 * hover, the same size and it scrolls with the play bar because it lives inside it. Its navigation
 * node is a copy of that same icon's node, registered under the icon row - with `fnCanTakeFocus`
 * and `childFocusDisabled` dropped, because a copy that keeps them answers for the *other* element
 * and reports `GetFocusable() = "none"` (measured: the controller then walks past it).
 *
 * The keeper is what makes this stable: Steam re-renders the row and can drop a foreign child, so
 * every 400 ms the element and its node are put back if they are missing. Verified on the client:
 * row children = [SCSKiller, controller wrapper, Manage], every one of them `self` or `children`,
 * node depth 10 under `_1thLDT_28YIf6OkgIb6n-4`.
 */

const ROUTE_APP = /\/routes\/library\/app\/(\d+)/;
const CONTROLLER_LABEL = "Configure Controller";
const TEMPLATE_LABEL = "Manage";
const BUTTON_ATTR = "data-scskiller-button";
const DOT_ATTR = "data-scskiller-dot";

/**
 * The clone keeps Steam's own class, so box, hover and spacing come from Steam. Only two things are
 * added: the focus look (Steam paints it from React state, which a clone does not have) and the dot.
 */
const CSS = `[${BUTTON_ATTR}]{position:relative}
[${BUTTON_ATTR}]:focus{background:#e6e8ea;color:#16191d;outline:none}
[${BUTTON_ATTR}] svg{pointer-events:none}
[${DOT_ATTR}]{position:absolute;right:4px;bottom:4px;width:9px;height:9px;border-radius:5px;border:1px solid rgba(0,0,0,0.55);background:#e05252;box-shadow:0 0 5px #e05252}`;

let timer: ReturnType<typeof setInterval> | undefined;
let ticks = 0;
let styleInstalled = false;
let insertReported = false;
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
    // a document without head: the clone keeps Steam's own colours
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
  button.addEventListener("focus", () => report("game page: button took the controller focus"));
  button.addEventListener("blur", () => report("game page: button released the focus"));
  row.insertBefore(button, row.firstChild);
  return button;
}

/** Copy the node of the row's own settings icon: same kind of control, same activation. */
function registerNode(row: Element, button: Element): boolean {
  const rowNode = nodeFor(row);
  if (!rowNode) return false;
  if (nodeFor(button)) return true;
  let template: any = null;
  for (const child of rowNode.m_rgChildren ?? []) {
    const element = child?.m_element;
    if (element && typeof element.getAttribute === "function" && element.getAttribute("aria-label") === TEMPLATE_LABEL) {
      template = child;
      break;
    }
  }
  if (!template) template = (rowNode.m_rgChildren ?? []).find((child: any) => child?.element !== button);
  if (!template) return false;
  const node = adopt(button, rowNode, template);
  if (!node) return false;
  // the button is the first child of the row: keep the node list in the same order as the DOM, then
  // let Steam re-sort it by geometry, exactly as it does for its own children
  try {
    const index = (rowNode.m_rgChildren ?? []).indexOf(node);
    if (index > 0) {
      rowNode.m_rgChildren.splice(index, 1);
      rowNode.m_rgChildren.unshift(node);
    }
    if (typeof rowNode.EnsureChildrenSorted === "function") rowNode.EnsureChildrenSorted();
    rowNode.m_ActiveChild = null;
  } catch {
    // the node stays where the copy put it
  }
  if (!nodeReported) {
    nodeReported = true;
    report(`game page: node registered in the icon row (${String(node.GetFocusable())})`);
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
        const own = target.hasAttribute(BUTTON_ATTR) ? " SCSKILLER" : "";
        const label = target.getAttribute("aria-label") ?? "";
        const text = String(target.textContent || "").trim().slice(0, 24);
        report(`focus: ${String(target.className || "").slice(0, 26)} label="${label}" text="${text}"${own}`);
      },
      true,
    );
  } catch {
    // no focus log on this build
  }
}

/** No child of the row may be a dead node: one `none` child makes the whole group unfocusable. */
function auditRow(rowNode: any): string {
  const marks = (rowNode.m_rgChildren ?? []).map((child: any) => {
    try {
      return String(child.GetFocusable());
    } catch {
      return "err";
    }
  });
  return marks.join(",");
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
    watchFocus(doc);
    const controller = doc.querySelector(`[aria-label="${CONTROLLER_LABEL}"]`);
    const row = controller?.parentElement?.parentElement;
    if (!row) return;
    let button = row.querySelector(`[${BUTTON_ATTR}]`) as HTMLElement | null;
    if (!button) {
      button = createButton(doc, row);
      if (!button) return;
      if (!insertReported) {
        insertReported = true;
        report("game page: button inserted in the icon row (copy of the native Manage icon)");
      }
      registerNode(row, button);
      return;
    }
    // Steam's re-render can drop the foreign child: put it back, then the node
    if (ticks % 4 === 1) {
      registerNode(row, button);
      const rowNode = nodeFor(row);
      if (rowNode && !nodeReported) report(`game page: row focus states ${auditRow(rowNode)}`);
    }
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
