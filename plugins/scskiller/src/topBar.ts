import { executeInTab } from "@decky/api";
import { cancelCompile, getCompiles, pauseCompile, resumeCompile, type CompileSnapshot } from "./api";
import { report } from "./api";

/**
 * The compile badge belongs to Big Picture's top icon row (where Steam shows its own badges),
 * so it is injected there as a clone of the search button - real flex child of the row, same
 * classes, same hover - instead of a floating element over the bar.
 *
 * A cloned node has no React handlers, so clicks only bump `window.__scskTopClicks`; the plugin
 * polls it, and also pushes the current compile state so the badge can show the game capsule
 * with a thin progress bar.
 */

const BPM = "Steam Big Picture Mode";

const INSTALL = `(() => {
  if (window.__scskTopInstalled) return "already";
  window.__scskTopInstalled = true;
  window.__scskTopClicks = window.__scskTopClicks || 0;

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
    const existing = document.querySelector("[data-scsk-top]");
    if (existing) {
      if (existing.parentElement === search.parentElement) return "present";
      existing.remove();
    }
    const button = document.createElement("div");
    button.setAttribute("data-scsk-top", "1");
    button.setAttribute("aria-label", "SCSKiller");
    button.className = search.className || "";
    button.style.cssText =
      "position:relative;display:none;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;width:40px;height:40px;min-width:40px;flex:0 0 40px;";
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("fill", "currentColor");
    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", "M13 2 4.5 13.2c-.4.5 0 1.3.6 1.3H10l-1 7.5L19.5 10c.4-.5 0-1.3-.6-1.3H14l1-6.7Z");
    svg.appendChild(path);
    button.appendChild(svg);
    const capsule = document.createElement("div");
    capsule.setAttribute("data-scsk-top-capsule", "1");
    // explicit size + centring: absolute insets collapse inside Steam's scaled icon row
    capsule.style.cssText =
      "position:absolute;left:50%;top:50%;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:2px;overflow:hidden;display:none;background:rgba(255,255,255,0.08);";
    button.appendChild(capsule);
    const bar = document.createElement("div");
    bar.setAttribute("data-scsk-top-bar", "1");
    bar.style.cssText =
      "position:absolute;left:4px;right:4px;bottom:3px;height:2px;border-radius:1px;background:rgba(255,255,255,0.25);overflow:hidden;display:none;";
    const fill = document.createElement("div");
    fill.style.cssText = "width:10%;height:100%;background:#1a9fff;";
    bar.appendChild(fill);
    button.appendChild(bar);
    // pause overlay: drawn over the game logo while the compile is frozen
    const pauseMark = document.createElement("div");
    pauseMark.setAttribute("data-scsk-top-pause", "1");
    pauseMark.style.cssText =
      "position:absolute;left:50%;top:50%;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:3px;" +
      "background:rgba(0,0,0,0.62);display:none;align-items:center;justify-content:center;gap:3px;";
    const pauseBar = (offset) => {
      const piece = document.createElement("div");
      piece.style.cssText =
        "width:3px;height:9px;border-radius:1px;background:#fff;margin-left:" + offset + "px;";
      return piece;
    };
    pauseMark.appendChild(pauseBar(0));
    pauseMark.appendChild(pauseBar(1));
    button.appendChild(pauseMark);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      window.__scskTopClicks += 1;
    });
    search.parentElement.insertBefore(button, search);
    return "inserted";
  };

  window.__scskTopRender = (appid, ratio, paused) => {
    const button = document.querySelector("[data-scsk-top]");
    if (!button) return;
    const capsule = button.querySelector("[data-scsk-top-capsule]");
    const bar = button.querySelector("[data-scsk-top-bar]");
    const pauseMark = button.querySelector("[data-scsk-top-pause]");
    const svg = button.querySelector("svg");
    if (!capsule || !bar || !svg) return;
    if (pauseMark) pauseMark.style.display = "none";
    if (!appid) {
      // nothing compiling: no badge at all in Steam's icon row
      capsule.style.display = "none";
      bar.style.display = "none";
      button.style.display = "none";
      return;
    }
    if (pauseMark && paused) {
      // paused: a pause glyph sits on top of the game logo, its progress bar goes grey
      pauseMark.style.display = "flex";
    }
    button.style.display = "";
    capsule.style.display = "block";
    capsule.innerHTML = "";
    const img = document.createElement("img");
    // a square logo reads far better than a squeezed capsule in a 40px badge
    img.src = "https://cdn.cloudflare.steamstatic.com/steam/apps/" + appid + "/logo.png";
    img.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;";
    img.onerror = () => {
      img.onerror = null;
      img.style.objectFit = "cover";
      img.src = "https://cdn.cloudflare.steamstatic.com/steam/apps/" + appid + "/capsule_231x87.jpg";
    };
    capsule.appendChild(img);
    svg.style.display = "none";
    bar.style.display = "block";
    const fill = bar.firstElementChild;
    if (fill) {
      fill.style.width = Math.max(4, Math.round(ratio * 100)) + "%";
      fill.style.background = paused ? "#8f98a0" : "#1a9fff";
    }
  };

  window.__scskPageAppid = (node) => {
    // React keeps the app overview on the fibre chain of the play bar: that is the only
    // reliable "which game is displayed" signal (location.pathname stays /index.html)
    let el = node;
    for (let depth = 0; el && depth < 6; depth++) {
      const keys = Object.keys(el);
      for (let index = 0; index < keys.length; index++) {
        const name = keys[index];
        if (name.indexOf("__reactFiber$") !== 0 && name.indexOf("__reactInternalInstance$") !== 0) continue;
        let fiber = el[name];
        for (let up = 0; fiber && up < 30; up++) {
          const props = fiber.memoizedProps || {};
          if (props.overview && props.overview.appid) return Number(props.overview.appid);
          if (props.app && props.app.appid) return Number(props.app.appid);
          if (typeof props.appid === "number" && props.appid) return props.appid;
          fiber = fiber.return;
        }
        return 0;
      }
      el = el.parentElement;
    }
    return 0;
  };

  window.__scskPlayRender = (appid, ratio, paused) => {
    const remove = (selector) => {
      const node = document.querySelector(selector);
      if (node) node.remove();
    };
    const restore = () => {
      const state = window.__scskPlayState;
      if (!state) return;
      state.hidden.forEach((node) => {
        try {
          node.style.visibility = "";
        } catch (error) {
          // the page is gone: nothing to restore
        }
      });
      if (state.box) state.box.style.backgroundColor = state.boxOriginal || "";
      if (state.stats) {
        try {
          state.stats.style.marginLeft = state.statsMargin || "";
        } catch (error) {
          // the page is gone: nothing to restore
        }
      }
      window.__scskPlayState = null;
    };
    const clear = () => {
      restore();
      remove("[data-scsk-play]");
      remove("[data-scsk-play-bar]");
      remove("[data-scsk-play-info]");
      remove("[data-scsk-cancel]");
    };
    if (!appid) {
      clear();
      return;
    }
    // Steam's play bar: the big button whose label is "Play"
    const leaves = Array.from(document.querySelectorAll("div, span")).filter(
      (el) => el.children.length === 0 && (el.textContent || "").trim() === "Play",
    );
    let button = null;
    for (const leaf of leaves) {
      const candidate = leaf.closest("[tabindex], button");
      if (!candidate) continue;
      const r = candidate.getBoundingClientRect();
      if (r.width > 120 && r.height > 30 && r.y > 200) {
        button = candidate;
        break;
      }
    }
    if (!button) {
      // no Play button on screen means we are not on a game page: leave nothing behind
      clear();
      return;
    }
    // the strip belongs to the compiling game's page only: never over another game's Play
    const pageAppid = window.__scskPageAppid(button);
    if (pageAppid && Number(pageAppid) !== Number(appid)) {
      clear();
      return;
    }
    const rect = button.getBoundingClientRect();
    const ratioValue = Math.max(0, Math.min(1, Number(ratio) || 0));
    const percent = Math.round(ratioValue * 1000) / 10;
    const percentText = percent.toFixed(1) + "% Complete";

    // 1. the button itself: keep Steam's own box (colour, radius, hover) and only swap the
    //    glyph and the label, at the measured native slots (glyph 24px at x+16, label at x+56)
    let overlay = document.querySelector("[data-scsk-play]");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.setAttribute("data-scsk-play", "1");
      overlay.style.cssText =
        "position:fixed;z-index:50;box-sizing:border-box;border-radius:2px;background:transparent;cursor:pointer;";
      overlay.addEventListener("mouseenter", () => {
        const state = window.__scskPlayState;
        if (!state) return;
        state.hover = true;
        if (state.box) state.box.style.backgroundColor = "rgba(220, 222, 223, 0.26)";
      });
      overlay.addEventListener("mouseleave", () => {
        const state = window.__scskPlayState;
        if (!state) return;
        state.hover = false;
        if (state.box) state.box.style.backgroundColor = state.boxBg || "";
      });
      overlay.addEventListener("click", (event) => {
        event.stopPropagation();
        window.__scskPauseClicks = (window.__scskPauseClicks || 0) + 1;
      });
      document.body.appendChild(overlay);
    }
    overlay.style.left = Math.round(rect.left) + "px";
    overlay.style.top = Math.round(rect.top) + "px";
    overlay.style.width = Math.round(rect.width) + "px";
    overlay.style.height = Math.round(rect.height) + "px";
    overlay.innerHTML =
      '<div style="position:absolute;left:16px;top:12px;width:24px;height:24px;color:#fff;">' +
      '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">' +
      (paused ? '<path d="M8 5v14l11-7z"/>' : '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>') +
      "</svg></div>" +
      '<span style="position:absolute;left:56px;top:14px;font-size:16px;font-weight:500;line-height:20px;color:#fff;">' +
      (paused ? "Resume" : "Pause") +
      "</span>";

    // hide Steam's own glyph + label underneath, and keep the painted box for the hover
    let state = window.__scskPlayState;
    if (!state || state.button !== button) {
      restore();
      const hidden = [];
      button.querySelectorAll("svg").forEach((node) => {
        const box = node.getBoundingClientRect();
        if (box.width < 40 && box.height < 40) {
          hidden.push(node);
          node.style.visibility = "hidden";
        }
      });
      const label = Array.from(button.querySelectorAll("div, span")).find(
        (node) => node.children.length === 0 && (node.textContent || "").trim() === "Play",
      );
      if (label) {
        hidden.push(label);
        label.style.visibility = "hidden";
      }
      let painted = null;
      button.querySelectorAll("div").forEach((node) => {
        if (painted) return;
        const box = node.getBoundingClientRect();
        const background = window.getComputedStyle(node).backgroundColor;
        if (Math.abs(box.width - rect.width) < 2 && Math.abs(box.height - rect.height) < 2 && background && background !== "rgba(0, 0, 0, 0)") {
          painted = node;
        }
      });
      // the Focusable itself turns green (rgb(89, 191, 64)) when Steam hands it the focus:
      // the resting fill is painted inline instead, and the child that paints it is hidden
      if (painted) {
        hidden.push(painted);
        painted.style.visibility = "hidden";
      }
      state = {
        button,
        hidden,
        box: button,
        boxOriginal: button.style.backgroundColor || "",
        boxBg: "rgba(220, 222, 223, 0.17)",
        hover: false,
        // the gamepad focus lands on Steam's own button (document.activeElement): our overlay
        // paints the box, so it has to paint THAT state too or the selection is invisible
        // (reported: "on Resume there is no highlight, you cannot tell you are on it")
        focused: document.activeElement === button,
      };
      window.__scskPlayState = state;
      if (!button.__scskFocusBound) {
        button.__scskFocusBound = true;
        button.addEventListener("focus", () => {
          const current = window.__scskPlayState;
          if (!current) return;
          current.focused = true;
        });
        button.addEventListener("blur", () => {
          const current = window.__scskPlayState;
          if (!current) return;
          current.focused = false;
        });
      }
    }
    if (state.box) {
      // measured on a page without this overlay: Steam paints a focused play button
      // rgb(89, 191, 64), the same green as a Focusable, with its white glyph and label
      const wanted = state.focused
        ? "rgb(89, 191, 64)"
        : state.hover
          ? "rgba(220, 222, 223, 0.26)"
          : state.boxBg;
      if (state.box.style.backgroundColor !== wanted) state.box.style.backgroundColor = wanted;
    }

    // 2. the compile state as a native stat column BETWEEN the button and LAST PLAYED:
    //    same 12px/700 + 0.5px letter-spacing label and 16px/500 white value. The native
    //    stats block is pushed right by the column width so nothing is hidden.
    let info = document.querySelector("[data-scsk-play-info]");
    if (!info) {
      info = document.createElement("div");
      info.setAttribute("data-scsk-play-info", "1");
      info.style.cssText = "position:fixed;z-index:50;pointer-events:none;display:flex;flex-direction:column;align-items:flex-start;";
      document.body.appendChild(info);
    }
    const columnWidth = innerWidth >= 1100 ? 160 : 130;
    const cancelSize = 48;
    // The cancel button is a real in-flow child of Steam's play bar row, right after the Play
    // group: a position:fixed box outside the row is skipped by the gamepad traversal, so the
    // controller could not reach it (reported 2026-11-22). In flow it also takes its own space,
    // and the plugin adopts a navigation node for it (gamepadFix.ts).
    let cancel = document.querySelector("[data-scsk-cancel]");
    if (!cancel) {
      cancel = document.createElement("div");
      cancel.setAttribute("data-scsk-cancel", "1");
      cancel.setAttribute("title", "Cancel compile");
      cancel.setAttribute("aria-label", "Cancel compile");
      // without tabindex Steam moves the navigation focus to the adopted node but never focuses
      // the element itself, so its focus/blur painting never runs (measured: activeElement stayed
      // on Play while the tree's lastFocusNode was the cancel)
      cancel.setAttribute("tabindex", "0");
      cancel.style.outline = "none";
      cancel.style.cssText =
        "box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex:0 0 auto;" +
        "width:48px;height:48px;border-radius:2px;background:rgba(172,178,201,0.14);color:#e6e8ea;cursor:pointer;" +
        "transition:background-color 0.12s ease, color 0.12s ease;";
      const resting = () => {
        cancel.style.background = "rgba(172,178,201,0.14)";
        cancel.style.color = "#e6e8ea";
      };
      cancel.addEventListener("mouseenter", () => {
        cancel.style.background = "rgba(205,213,226,0.26)";
      });
      cancel.addEventListener("mouseleave", () => {
        if (document.activeElement !== cancel) resting();
      });
      // the focused look of Steam's own action icons: white box, dark glyph
      cancel.addEventListener("focus", () => {
        cancel.style.background = "#e6e8ea";
        cancel.style.color = "#16191d";
      });
      cancel.addEventListener("blur", resting);
      const press = (event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        window.__scskCancelClicks = (window.__scskCancelClicks || 0) + 1;
      };
      cancel.addEventListener("click", press);
      // Steam activates the focused element by dispatching vgp_onok: without it the pad's A is
      // silent on this button while the mouse click works
      cancel.addEventListener("vgp_onok", press);
      document.body.appendChild(cancel);
    }
    // The play bar row is the ancestor of the button that lays its children out in a row and also
    // holds the "LAST PLAYED" stats column: climbing two levels is not enough (Steam wraps the
    // button in a column group, and an insert there stacks the cancel UNDER it - measured).
    const isPlayRow = (element) => {
      if (!element) return false;
      if (getComputedStyle(element).flexDirection !== "row") return false;
      return /last played/i.test(element.textContent || "");
    };
    let row = button.parentElement;
    for (let up = 0; up < 8 && row && row.parentElement; up++) {
      if (isPlayRow(row.parentElement)) {
        row = row.parentElement;
        break;
      }
      row = row.parentElement;
    }
    let anchor = button;
    while (anchor.parentElement && anchor.parentElement !== row) anchor = anchor.parentElement;
    if (row && cancel.parentElement !== row) {
      row.insertBefore(cancel, anchor.nextSibling);
    }
    cancel.style.width = cancelSize + "px";
    cancel.style.height = cancelSize + "px";
    cancel.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"' +
      ' stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';
    // the compile column starts 16px after the button now that it is in flow
    const cancelBox = cancel.getBoundingClientRect();
    const cancelLeft = Math.round(cancelBox.left || rect.right);
    const columnLeft = Math.round((cancelBox.right || cancelBox.left + cancelSize) + 16);
    // the stats block is the ancestor of the "LAST PLAYED" label whose parent also holds
    // the play button: that is the flex item to push right
    let stats = state.stats;
    if (stats && (!stats.isConnected || !/LAST PLAYED/i.test(stats.innerText || ""))) {
      // the page re-rendered: the element we had pushed aside is gone
      stats.style.marginLeft = state.statsMargin || "";
      state.stats = null;
      state.statsLeft = undefined;
      stats = null;
    }
    if (!stats) {
      const label = Array.from(document.querySelectorAll("div, span")).find(
        (node) => node.children.length === 0 && /^(Last Played|LAST PLAYED)$/.test((node.textContent || "").trim()),
      );
      let node = label;
      for (let up = 0; up < 12 && node && node.parentElement; up++) {
        if (node.parentElement.contains(button) && node !== button && !node.contains(button)) {
          stats = node;
          break;
        }
        node = node.parentElement;
      }
      if (stats) {
        state.stats = stats;
        state.statsMargin = stats.style.marginLeft || "";
        // remember the unshifted position: measuring the shifted box would make the shift
        // swing between 0 and its full value on every tick
        state.statsLeft = Math.round(stats.getBoundingClientRect().left - (parseFloat(state.statsMargin) || 0));
        stats.style.marginLeft = state.statsMargin;
      }
    }
    if (stats && typeof state.statsLeft === "number") {
      const shift = Math.max(0, Math.round(columnLeft + columnWidth + 20 - state.statsLeft));
      const next = shift > 0 ? shift + "px" : state.statsMargin || "";
      if (stats.style.marginLeft !== next) stats.style.marginLeft = next;
    }
    info.style.left = columnLeft + "px";
    info.style.top = Math.round(rect.top + 1) + "px";
    info.style.width = columnWidth + "px";
    info.innerHTML =
      '<div style="font-size:12px;font-weight:700;letter-spacing:0.5px;line-height:22px;height:22px;color:rgba(255,255,255,0.7);text-transform:uppercase;white-space:nowrap;">' +
      (paused ? "Compile paused" : "Compiling") +
      '</div><div style="display:inline-block;font-size:16px;font-weight:500;line-height:20px;color:#fff;white-space:nowrap;">' +
      percentText +
      '</div><div data-scsk-play-bar-inner style="margin-top:2px;height:3px;border-radius:2px;background:rgba(220,222,223,0.24);overflow:hidden;">' +
      '<div style="width:' +
      Math.max(2, Math.round(percent)) +
      "%;height:100%;background:" +
      (paused ? "#8f98a0" : "#1a9fff") +
      ';"></div></div>';
    // the bar is as wide as the percentage text, not as the whole column: a column-wide
    // bar reads as a page-wide progress strip and looked far too long on the play bar
    try {
      const value = info.children[1];
      const track = info.querySelector("[data-scsk-play-bar-inner]");
      if (value && track) {
        const width = Math.round(value.getBoundingClientRect().width);
        if (width > 40) track.style.width = width + "px";
      }
    } catch {
      // keep the fallback width
    }
  };

  window.__scskTopOff = () => {
    const node = document.querySelector("[data-scsk-top]");
    if (node) node.remove();
    window.__scskTopInstalled = false;
  };

  insert();
  window.__scskTopTick = setInterval(insert, 1200);
  return "installed";
})()`;

function firstRunning(jobs: CompileSnapshot[]): { appid: number; ratio: number; paused: boolean } | null {
  const job = jobs.find((item) => item.running);
  if (!job) return null;
  const appid = Number(String(job.app_id).replace(/^steam:/, ""));
  // no "done/total" line yet: Steam itself shows 0.0% until it has numbers
  let ratio = 0;
  const lines = job.lines ?? [];
  for (let index = lines.length - 1; index >= 0; index--) {
    const match = String(lines[index]?.text ?? "").match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
    if (match) {
      const done = Number(match[1].replace(/,/g, ""));
      const total = Number(match[2].replace(/,/g, ""));
      if (total > 0) {
        ratio = Math.max(0, Math.min(1, done / total));
        break;
      }
    }
  }
  return { appid, ratio: Number.isFinite(ratio) ? ratio : 0, paused: Boolean(job.paused) };
}

/**
 * Steam tracks the games it launched in `SteamUIStore.m_runningAppIDs`. The plugin lives in
 * the same JS context, so a game launch is visible there without touching the game process.
 */
function runningApps(): number[] {
  try {
    const store: any = (window as any).SteamUIStore;
    const ids = store?.m_runningAppIDs;
    if (!ids || typeof ids.length !== "number") return [];
    const list: number[] = [];
    for (let index = 0; index < ids.length; index++) {
      const value = Number(ids[index]);
      if (Number.isFinite(value) && value > 0) list.push(value);
    }
    return list;
  } catch {
    return [];
  }
}

export function installTopBar(open: () => void): () => void {
  let stopped = false;
  let seen = 0;
  let seenPause = 0;
  let seenCancel = 0;
  let ticks = 0;
  let pausedForLaunch = false;

  const ping = async () => {
    if (stopped) return;
    try {
      // the clicks are polled on every tick (250ms): that is what makes the page feel instant
      const reply: any = await executeInTab(
        BPM,
        false,
        "String((window.__scskTopClicks || 0) + ':' + (window.__scskPauseClicks || 0) + ':' + (window.__scskCancelClicks || 0))",
      );
      const [topClicks, pauseClicks, cancelClicks] = String(reply?.result ?? "0:0:0").split(":").map(Number);
      if (topClicks > seen) {
        seen = topClicks;
        open();
      }
      // a launched game means the GPU is taken: freeze the compile, once per launch
      const games = runningApps();
      if (games.length === 0) {
        pausedForLaunch = false;
      } else if (!pausedForLaunch) {
        pausedForLaunch = true;
        const compiles = await getCompiles();
        const running = firstRunning(compiles?.jobs ?? []);
        if (running && !running.paused) {
          const response: any = await pauseCompile();
          report(
            `topbar: game ${games.join(",")} launched, compile paused (${response?.ok ? "ok" : String(response?.error ?? "failed")})`,
          );
        }
      }
      if (cancelClicks > seenCancel) {
        seenCancel = cancelClicks;
        const response: any = await cancelCompile();
        report(`topbar: cancel requested from the game page (${response?.ok ? "ok" : String(response?.error ?? "failed")})`);
      }
      if (pauseClicks > seenPause) {
        seenPause = pauseClicks;
        const compiles = await getCompiles();
        const running = firstRunning(compiles?.jobs ?? []);
        if (running) {
          if (running.paused) await resumeCompile();
          else await pauseCompile();
        }
      }
      // the rest is housekeeping, one second apiece is plenty
      if (ticks % 8 === 0) {
        const res: any = await executeInTab(BPM, false, INSTALL);
        if (String(res?.result ?? "") === "installed") report("topbar: badge injected in the icon row");
      }
      if (ticks % 4 === 0) {
        const compiles = await getCompiles();
        const running = firstRunning(compiles?.jobs ?? []);
        const badge = running
          ? `window.__scskTopRender(${running.appid}, ${running.ratio.toFixed(3)}, ${running.paused ? "true" : "false"})`
          : "window.__scskTopRender(0, 0, false)";
        const play = running
          ? `window.__scskPlayRender(${running.appid}, ${running.ratio.toFixed(3)}, ${running.paused ? "true" : "false"})`
          : "window.__scskPlayRender(0, 0, false)";
        await executeInTab(BPM, false, badge + "; " + play);
      }
      ticks += 1;
    } catch {
      // the window may be gone while Steam restarts
    }
  };

  ping();
  const timer = window.setInterval(ping, 250);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    try {
      void executeInTab(BPM, false, "window.__scskTopOff && window.__scskTopOff()");
    } catch {
      // window gone
    }
  };
}
