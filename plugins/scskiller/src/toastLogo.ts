import { executeInTab } from "@decky/api";

/**
 * Decky's Big Picture toast has two text slots and a text-only "icon" slot: it cannot show
 * an image. The compile result therefore decorates its own toast: the game's logo is
 * inserted in front of the title, inside the toast's title row.
 *
 * The toast lives in its own CEF window (`notificationtoasts_uid<N>`), so the DOM is touched
 * through `executeInTab`, retried for a few seconds because the toast appears asynchronously.
 */

const CANDIDATES = ["notificationtoasts_uid2", "notificationtoasts_uid1", "notificationtoasts_uid3"];

function script(title: string, url: string): string {
  const quotedTitle = JSON.stringify(title);
  const quotedUrl = JSON.stringify(url);
  return (
    "(() => {" +
    "const toasts = Array.from(document.querySelectorAll('.DeckyGamepadUIPopupToast'));" +
    "const toast = toasts.find((node) => (node.textContent || '').indexOf(" +
    quotedTitle +
    ") >= 0);" +
    "if (!toast) return 'notoast';" +
    "if (toast.querySelector('[data-scsk-logo]')) return 'done';" +
    "const titleNode = Array.from(toast.querySelectorAll('div')).find(" +
    "(node) => node.children.length === 0 && (node.textContent || '').trim() === " +
    quotedTitle +
    ");" +
    "if (!titleNode || !titleNode.parentElement) return 'notitle';" +
    "const logo = document.createElement('img');" +
    "logo.setAttribute('data-scsk-logo', '1');" +
    "logo.setAttribute('alt', '');" +
    "logo.src = " +
    quotedUrl +
    ";" +
    "logo.style.cssText = 'width:28px;height:28px;flex:0 0 auto;object-fit:contain;border-radius:2px;' +" +
    "'margin-right:8px;align-self:center;display:block;';" +
    "logo.addEventListener('error', () => { logo.style.display = 'none'; });" +
    "titleNode.parentElement.insertBefore(logo, titleNode);" +
    "return 'decorated';" +
    "})()"
  );
}

/** Put the game logo in the toast that carries `title` (retried: the toast mounts late). */
export function decorateToastLogo(appid: string, title: string): void {
  if (!appid) return;
  const url = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/logo.png`;
  let attempt = 0;
  let done = false;
  const tick = async () => {
    if (done || attempt > 12) return;
    attempt += 1;
    for (const target of CANDIDATES) {
      try {
        const reply: any = await executeInTab(target, false, script(title, url));
        const result = String(reply?.result ?? "");
        if (result === "decorated" || result === "done") {
          done = true;
          return;
        }
      } catch {
        // this window title does not exist on this client
      }
    }
  };
  void tick();
  const timer = window.setInterval(() => {
    void tick();
    if (done || attempt > 12) window.clearInterval(timer);
  }, 400);
}
