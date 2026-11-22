import { useEffect, useState, type RefObject } from "react";

/**
 * Width of the Decky panel, measured from the plugin's own root element.
 *
 * Steam caps the Quick Access Menu tab panel at 300px and the visible strip is 348px
 * (48px icon rail + 300px panel), so **300 is the real maximum**: widening the panel only
 * pushes the extra columns off the screen (the launcher's own surface also crops the right
 * edge). The plugin therefore keeps Steam's width and fits its content inside it; the
 * measured value is used to pick the layout (table on a wide panel, compact rows below).
 */
export const WIDE_FROM = 620;

export function useWidePanel(rootRef: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const measure = () => {
      try {
        const next = Math.round(root.getBoundingClientRect().width);
        setWidth((current) => (current === next ? current : next));
      } catch {
        setWidth(0);
      }
    };

    measure();
    const settle = window.setTimeout(measure, 120);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(measure);
      try {
        observer.observe(root);
      } catch {
        observer = null;
      }
    }
    // CEF suspends resize notifications for an occluded window
    const poll = window.setInterval(measure, 500);

    return () => {
      window.clearTimeout(settle);
      window.clearInterval(poll);
      observer?.disconnect();
    };
  }, []);

  return width;
}
