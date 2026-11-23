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
      "width:40px;height:40px;min-width:40px;flex:0 0 40px;";
    badge.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#76b900" stroke-width="2.1"' +
      ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3v10"/><path d="M7.8 9.4 12 13.6l4.2-4.2"/><path d="M5 19h14"/></svg>';
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
