import { executeInTab } from "@decky/api";
import { report } from "./api";

/**
 * The badge lives in Big Picture's top icon row, next to the search button, because that is
 * where Steam draws its own badges. The plugin realm cannot query that document (its window
 * is 1x1), so the badge is injected through `executeInTab`: a clone of the search button, so
 * it inherits the row's real classes, spacing and hover. It stays hidden until the backend
 * reports a newer driver.
 *
 * A clone has no React handlers: clicks only bump `window.__nvdrvClicks`, which the plugin
 * polls, exactly like the SCSKiller badge does.
 */

const BPM = "Steam Big Picture Mode";

let desired = { update: false, version: "" };

export function setTopBarState(next: { update: boolean; version: string }): void {
  desired = next;
}

const INSTALL = `(() => {
  if (window.__nvdrvInstalled) return "already";
  window.__nvdrvInstalled = true;
  window.__nvdrvClicks = window.__nvdrvClicks || 0;

  const findSearch = () => {
    const labelled = Array.from(document.querySelectorAll("[aria-label]")).find((el) =>
      /search/i.test(el.getAttribute("aria-label") || ""),
    );
    if (labelled) return labelled;
    const rows = Array.from(document.querySelectorAll("div")).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.y >= 0 && r.y < 46 && r.width > 400 && r.height >= 24 && r.height <= 60;
    });
    for (const row of rows) {
      const icons = Array.from(row.querySelectorAll("[tabindex], [aria-label]")).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.y < 46 && r.width >= 24 && r.width <= 60 && r.height >= 24 && r.height <= 60;
      });
      if (icons.length) return icons[0];
    }
    return null;
  };

  const insert = () => {
    const search = findSearch();
    if (!search || !search.parentElement) return "no-row";
    const existing = document.querySelector("[data-nvdrv-badge]");
    if (existing) {
      if (existing.parentElement === search.parentElement) return "present";
      existing.remove();
    }
    const badge = document.createElement("div");
    badge.setAttribute("data-nvdrv-badge", "1");
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "-1");
    badge.className = search.className || "";
    badge.style.cssText =
      "position:relative;display:none;align-items:center;justify-content:center;cursor:pointer;" +
      "box-sizing:border-box;width:40px;height:40px;min-width:40px;max-width:40px;flex:0 0 40px;" +
      "padding:0;margin:0;";
    badge.innerHTML =
      '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">' +
      '<path d="M8.948 8.798v-1.43a6.7 6.7 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.062-1.158-.185v-4.346c1.528.185 1.837.857 2.747 2.385l2.04-1.714s-1.492-1.952-4-1.952a6.016 6.016 0 0 0-.796.035m0-4.735v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.37 0-.733-.035-1.095-.097v1.325c.3.035.61.062.91.062 3.957 0 6.82-2.023 9.593-4.408.459.371 2.34 1.263 2.73 1.652-2.633 2.208-8.772 3.984-12.253 3.984-.335 0-.653-.018-.971-.053v1.864zm0 10.326v1.131c-3.657-.654-4.673-4.46-4.673-4.46s1.758-1.944 4.673-2.262v1.237H8.94c-1.528-.186-2.73 1.245-2.73 1.245s.68 2.412 2.739 3.11M2.456 10.9s2.164-3.197 6.5-3.533V6.201C4.153 6.59 0 10.653 0 10.653s2.35 6.802 8.948 7.42v-1.237c-4.84-.6-6.492-5.936-6.492-5.936z" fill="#76b900"/>' +
      '<g fill="none" stroke="#e6e8ea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 4.5v8"/><path d="M9 9.8l3 3 3-3"/><path d="M6.5 17h11"/></g>' +
      "</svg>";
    badge.addEventListener("click", (event) => {
      event.stopPropagation();
      window.__nvdrvClicks += 1;
    });
    search.parentElement.insertBefore(badge, search);
    return "inserted";
  };

  window.__nvdrvRender = (update, version) => {
    const badge = document.querySelector("[data-nvdrv-badge]");
    if (!badge) return;
    const label = version
      ? "NVIDIA driver " + version + " available"
      : "NVIDIA driver update available";
    badge.style.display = update ? "flex" : "none";
    if (update) {
      badge.setAttribute("title", label);
      badge.setAttribute("aria-label", label);
    }
  };

  window.__nvdrvOff = () => {
    if (window.__nvdrvTimer) clearInterval(window.__nvdrvTimer);
    const node = document.querySelector("[data-nvdrv-badge]");
    if (node) node.remove();
    window.__nvdrvInstalled = false;
  };

  insert();
  window.__nvdrvTimer = setInterval(insert, 1500);
  return "installed";
})()`;

function renderCall(): string {
  return `window.__nvdrvRender && window.__nvdrvRender(${desired.update ? "true" : "false"}, ${JSON.stringify(
    desired.version || "",
  )})`;
}

export function pushTopBar(): void {
  executeInTab(BPM, false, renderCall()).catch(() => undefined);
}

export function installTopBar(open: () => void): () => void {
  let stopped = false;
  let seenClicks = 0;
  let ticks = 0;

  const ping = async () => {
    if (stopped) return;
    try {
      const reply: any = await executeInTab(BPM, false, "String(window.__nvdrvClicks || 0)");
      const clicks = Number(String(reply?.result ?? "0"));
      if (Number.isFinite(clicks) && clicks > seenClicks) {
        seenClicks = clicks;
        open();
      }
      if (ticks % 5 === 0) {
        const res: any = await executeInTab(BPM, false, INSTALL);
        if (String(res?.result ?? "") === "installed") report("topbar: badge injected in the icon row");
      }
      if (ticks % 3 === 0) {
        await executeInTab(BPM, false, renderCall());
      }
      ticks += 1;
    } catch {
      // the window may be gone while Steam restarts
    }
  };

  ping();
  const timer = window.setInterval(ping, 1000);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    try {
      void executeInTab(BPM, false, "window.__nvdrvOff && window.__nvdrvOff()");
    } catch {
      // window gone
    }
  };
}
