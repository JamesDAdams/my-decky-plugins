import { Focusable } from "@decky/ui";
import { useState } from "react";
import { COLORS, FOCUS_RING } from "./atoms";

export interface TabDef {
  id: string;
  label: string;
  /** Small counter shown next to the label (running compiles). */
  badge?: number;
}

/**
 * The three tabs are real `Focusable`s so the gamepad can reach them (Steam's navigator moves
 * between focusable elements; a plain div is skipped) and A activates them. `noFocusRing`
 * removes Steam's grey outline, so the focused tab gets its own ring - otherwise the user
 * cannot see where the cursor is.
 */
export function TabStrip({
  tabs,
  active,
  onSelect,
}: {
  tabs: TabDef[];
  active: string;
  onSelect: (id: string) => void;
}) {
  const [focused, setFocused] = useState<string | null>(null);

  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        alignItems: "center",
        borderBottom: `1px solid ${COLORS.line}`,
        marginBottom: 8,
        paddingBottom: 6,
        flexWrap: "nowrap",
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        const isFocused = focused === tab.id;
        return (
          <Focusable
            key={tab.id}
            noFocusRing
            onActivate={() => onSelect(tab.id)}
            onClick={() => onSelect(tab.id)}
            onFocus={() => setFocused(tab.id)}
            onBlur={() => setFocused((current) => (current === tab.id ? null : current))}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "5px 8px",
              borderRadius: 3,
              background: selected
                ? "rgba(255, 255, 255, 0.16)"
                : isFocused
                  ? "rgba(255, 255, 255, 0.1)"
                  : "transparent",
              color: selected || isFocused ? COLORS.text : COLORS.dim,
              fontSize: 11.5,
              fontWeight: 600,
              whiteSpace: "nowrap",
              boxShadow: isFocused ? FOCUS_RING : "none",
              transition: "background-color 0.12s ease, color 0.12s ease",
            }}
          >
            <span>{tab.label}</span>
            {tab.badge ? (
              <span
                style={{
                  minWidth: 18,
                  padding: "0 5px",
                  borderRadius: 9,
                  background: COLORS.accent,
                  color: "#fff",
                  fontSize: 11,
                  lineHeight: "16px",
                  textAlign: "center",
                  boxSizing: "border-box",
                }}
              >
                {tab.badge}
              </span>
            ) : null}
          </Focusable>
        );
      })}
    </div>
  );
}
