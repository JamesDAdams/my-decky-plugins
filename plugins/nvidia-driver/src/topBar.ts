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
      '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAACXBIWXMAABuvAAAbrwFeGpEcAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAOdSURBVHgB7VZNUhpBGH09JFbULLhB8ASaEwQW8Scb9QTBE4gL0coG2AWyCJ5AOYG6MsEF5gThBnIENhLLyEzea2ZgGFEhaspKzauaYprp/vp97/vpBmLEiBEjRoyHwOAByH9HkT8FPD5KlSVrGw6eOZ49wReTTC4eItl5jazxMA8Pac/BXuV9L02261hIdJH0DNb4z6oHpPAIGIvg7inJeCh0SAouQBJtkmjxPblbR9a+X6P1eQVNTj/jk9s94ZoECp7WPBXBgJjrchOSonJ7fI5eXaJZXEdbReJ62KeaNlk4bhmDqunimGTPRJZEs1S68LeKjqxiGk25L/CVCq3ZSQYH0xfYEqmhOQ7DbfAG2txDKkSiRZVLXxZxoEGugeTUFap8/Yjx0K/iGwpShTXXUBWGT6oxdBvlDzjSNz8HN42LrNsjUyovYiNEOi3SIkKl93fqeGcdy1jHsvkTpoIzWVtyIuS0+JBqJI1UADIVn1z+lDk4i3MSLyrnFO7AoWC9wkrPs5xT0pjpke3MoCHHNK6scK3/bWKC23XreTEYU6UNhqgp41SiYYmROJ8tqpYpLyPnTz0kyfOARJ8Ieo4RC51pa9ti5pKhNoNUGZvg75c0GFrIMC/ot520SqQtaUOFlm0uRZH6NUvl0UsD6xD6yjaDNTZFqKh1dFKCVeVJtxc2C4PN/v9ATe8iquIYZUjfmAY5EvgZai3NmQ4yQ+TQc3xigoJCo9zzh6n8t14Yr6b466vL3rZ/qzWXlT+o5JrIqfLllIj3ydGW4yLDZyO03/0E7R4G6/2BQUHGpaLT7f0vdXZOLZHRkCPMUxWLyDHcm27Ckkv5M5q09VYFxeegvIS5u4jeIKjCYKi3/GGSbaMhkn7jXbfV7SKnwuDqeY3tw/xUhc5cYE45pzXKRTpUDXJOlS9VaWuIjIh6g6KK+HsL2LOKoZ7VUkhk2G/QajWr3HgvaKgBdPqwR24GTd5uQvI8XUq+k4jO12kVORL7jfrO+2CUZPh0sN951PknCaQSv6fDFeoTq0mhMYlNRtAaomI8SxvBMaZNqVBt9gJHTHwV0fDJYNBkD/2hMzuqWOg2tHrPJWJ8giGiow79EkN/1k2gzatWO5pbwidew66p7BikHkYwRDRt73wsEBbLseMNkttJsKjYSjzdF9noPbWVCZryKIITXViF4Bqld3vdMqxmH64XmujhUfB/XfmjUP65T+Ci7CJGjBgx/g3+AB9Mpl+HaWRWAAAAAElFTkSuQmCC" width="32" height="32" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none" alt="">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;filter:drop-shadow(0 0 2px #000) drop-shadow(0 0 1px #000)" aria-hidden="true">' +
      '<g fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 4v10"/><path d="M8 10.4l4 4 4-4"/><path d="M6 19h12"/></g></svg>';
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
