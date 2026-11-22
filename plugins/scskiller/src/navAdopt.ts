/**
 * Make a plugin-drawn control reachable with a controller.
 *
 * Big Picture moves the gamepad focus through a tree of navigation nodes registered on
 * `SteamUIStore.NavigationManager.m_ActiveContext.m_rgGamepadNavigationTrees`. Each node keeps its
 * DOM element in `m_element`, its parent in `m_Parent` and its children in `m_rgChildren`.
 *
 * An element that Steam's own `Focusable` component did not register - a DOM clone appended to a
 * native row, for instance - simply is not in that tree: the mouse can click it, the controller
 * cannot reach it. The same goes for a React element whose node is registered under the page
 * container instead of the row it is drawn over.
 *
 * `tools/nav-audit.mjs` lists the navigable elements and their parent, which is how every claim
 * here is checked on the live client.
 */

/**
 * A navigation node keeps its focus state in two subscribables (`m_Focused`, `m_FocusWithin`), and
 * Steam calls `node.m_Focused.Set(...)` when the focus moves. A copy that holds a plain `false`
 * throws there - and a throw inside the traversal is what makes a whole focus group unreachable
 * (measured: with booleans, the game page's three icons could not be focused from Play at all, and
 * `node.BTakeFocus` answered "this.m_Focused.Set is not a function").
 */
export function makeFocusState(template: any): any {
  if (!template || typeof template !== "object") return template;
  try {
    const ctor = Object.getPrototypeOf(template)?.constructor;
    if (typeof ctor === "function") {
      const fresh = new ctor(false);
      if (fresh && typeof fresh.Set === "function") return fresh;
    }
  } catch {
    // fall through to a hand-made copy
  }
  const copy = Object.create(Object.getPrototypeOf(template));
  copy.m_callbacks = { m_vecCallbacks: [] };
  copy.m_currentValue = false;
  copy.m_fnEquals = undefined;
  return copy;
}
export type NavNode = any;

/** Every navigation tree of the active context (Big Picture, the left menu, the QAM...). */
export function navTrees(): NavNode[] {
  try {
    const manager = (window as any).SteamUIStore?.NavigationManager;
    const context = manager?.m_ActiveContext;
    return context ? Array.from(context.m_rgGamepadNavigationTrees ?? []) : [];
  } catch {
    return [];
  }
}

/** Depth-first walk over the navigation nodes; return true from `visit` to stop. */
export function walkNodes(visit: (node: NavNode, element: HTMLElement) => boolean | void): boolean {
  const seen = new Set<any>();
  const walk = (node: any, depth: number): boolean => {
    if (!node || typeof node !== "object" || seen.has(node) || depth > 40) return false;
    seen.add(node);
    for (const key of Object.keys(node)) {
      let value: any;
      try {
        value = node[key];
      } catch {
        continue;
      }
      if (value && value.nodeType === 1) {
        if (visit(node, value) === true) return true;
      } else if (Array.isArray(value) && /child|focusable|node/i.test(key)) {
        for (const child of value.slice(0, 200)) {
          if (walk(child, depth + 1)) return true;
        }
      }
    }
    return false;
  };
  for (const tree of navTrees()) {
    if (walk(tree?.m_Root, 0)) return true;
  }
  return false;
}

/** The visible Big Picture document, taken from a node that lives in it. */
export function uiDocument(): Document | null {
  let doc: Document | null = null;
  walkNodes((_node, element) => {
    const owner = element.ownerDocument;
    if (owner && owner !== document) {
      doc = owner;
      return true;
    }
  });
  return doc;
}

/** Steam focuses its own items with tabindex 0; a clone keeps -1 and cannot take DOM focus. */
function makeFocusable(element: Element | null | undefined): void {
  try {
    if (element && element.getAttribute && element.getAttribute("tabindex") === "-1") {
      element.setAttribute("tabindex", "0");
    }
  } catch {
    // a detached element: nothing to do
  }
}

/** The navigation node of a DOM element, if the controller can already reach it. */
export function nodeFor(element: Element | null | undefined): NavNode | null {
  if (!element) return null;
  let hit: NavNode | null = null;
  walkNodes((node, candidate) => {
    if (candidate === element) {
      hit = node;
      return true;
    }
  });
  return hit;
}

/** Move an existing node under another one (same element, new focus group). */
export function moveUnder(node: NavNode, parent: NavNode): boolean {
  if (!node || !parent || node === parent) return false;
  if (node.m_Parent === parent) return true;
  try {
    const previous = node.m_Parent;
    if (previous && Array.isArray(previous.m_rgChildren)) {
      const index = previous.m_rgChildren.indexOf(node);
      if (index >= 0) previous.m_rgChildren.splice(index, 1);
    }
    node.m_Parent = parent;
    if (parent.m_Tree) node.m_Tree = parent.m_Tree;
    node.m_nDepth = (parent.m_nDepth ?? 0) + 1;
    // measured: traversal only keeps a child whose GetFocusable() is not "none", and that reads
    // m_Properties.focusable - a node without it stays in the tree but is skipped by the D-pad
    node.m_Properties = Object.assign({ focusable: true }, node.m_Properties ?? {});
    makeFocusable(node.m_element);
    if (!Array.isArray(parent.m_rgChildren)) parent.m_rgChildren = [];
    parent.m_rgChildren.push(node);
    parent.m_bChildrenSorted = false;
    parent.m_ActiveChild = null;
    node.m_bMounted = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Register an element that Steam never registered, by copying the node of a native control of the
 * same kind (same class, same handlers) and pointing it at this element.
 */
export function adopt(element: Element | null | undefined, parent: NavNode, template: NavNode): NavNode | null {
  if (!element || !parent || !template) return null;
  try {
    const node: NavNode = Object.create(Object.getPrototypeOf(template));
    for (const key of Object.keys(template)) {
      try {
        node[key] = template[key];
      } catch {
        // read-only field: keep the copy's default
      }
    }
    node.m_element = element;
    node.m_Parent = parent;
    node.m_Tree = parent.m_Tree ?? template.m_Tree;
    node.m_nDepth = (parent.m_nDepth ?? 0) + 1;
    node.m_rgChildren = [];
    node.m_ActiveChild = null;
    node.m_iLastActiveChildIndex = -1;
    node.m_bMounted = true;
    node.m_Focused = makeFocusState(template.m_Focused);
    node.m_FocusWithin = makeFocusState(template.m_FocusWithin);
    node.m_bChildrenSorted = true;
    // the focus filter (GetFocusable) reads m_Properties.focusable; without it the node is in
    // the tree but the D-pad walks straight past it. Measured (2026-11-22): the copy also inherits
    // the template's fnCanTakeFocus, which answers for the *template's* element, so the copy reports
    // "none" and the D-pad skips it. Both keys are dropped and focusable is forced.
    const properties: Record<string, unknown> = Object.assign({}, node.m_Properties ?? template.m_Properties ?? {});
    delete properties.fnCanTakeFocus;
    delete properties.childFocusDisabled;
    properties.focusable = true;
    node.m_Properties = properties;
    makeFocusable(element);
    if (!Array.isArray(parent.m_rgChildren)) parent.m_rgChildren = [];
    parent.m_rgChildren.push(node);
    parent.m_bChildrenSorted = false;
    parent.m_ActiveChild = null;
    return node;
  } catch {
    return null;
  }
}
