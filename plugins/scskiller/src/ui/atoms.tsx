import { Focusable } from "@decky/ui";
import { useState, type CSSProperties, type ReactNode } from "react";

/** Palette and small pieces shared by the panel, so every row lines up. */
export const COLORS = {
  text: "#e6e8ea",
  dim: "rgba(230, 232, 234, 0.62)",
  faint: "rgba(230, 232, 234, 0.38)",
  line: "rgba(255, 255, 255, 0.09)",
  hover: "rgba(255, 255, 255, 0.07)",
  surface: "rgba(255, 255, 255, 0.045)",
  accent: "#1a9fff",
  green: "#5bc236",
  red: "#e05252",
  amber: "#f5c442",
};

export const MONO = "ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Consolas, monospace";

/** Visible focus ring: `noFocusRing` removes Steam's, gamepad navigation still needs one. */
export const FOCUS_RING = "inset 0 0 0 2px rgba(255, 255, 255, 0.75)";

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: size,
        background: color,
        flex: "0 0 auto",
      }}
    />
  );
}

/** A compact Steam-like push button (48px icons are too large inside a table row). */
export function SmallButton({
  children,
  onClick,
  disabled,
  tone = "normal",
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "normal" | "primary" | "danger";
  style?: CSSProperties;
}) {
  const background =
    tone === "primary" ? COLORS.accent : tone === "danger" ? "rgba(224, 82, 82, 0.85)" : "rgba(255, 255, 255, 0.1)";
  const [focused, setFocused] = useState(false);
  return (
    <Focusable
      noFocusRing
      onActivate={disabled ? undefined : onClick}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      // a row opens its details on click: a click on this button must not bubble into it
      onClick={
        disabled
          ? undefined
          : (event: any) => {
              event?.stopPropagation?.();
              onClick?.();
            }
      }
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "5px 12px",
        borderRadius: 3,
        background,
        color: COLORS.text,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        flex: "0 0 auto",
        boxSizing: "border-box",
        opacity: disabled ? 0.45 : 1,
        boxShadow: focused ? FOCUS_RING : "none",
        transition: "background-color 0.12s ease",
        ...style,
      }}
    >
      <span>{children}</span>
    </Focusable>
  );
}

/** One line of muted explanation inside a tab. */
export function Hint({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, color: COLORS.dim, lineHeight: 1.45, padding: "4px 2px" }}>{children}</div>;
}
