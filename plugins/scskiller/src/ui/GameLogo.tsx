import { useMemo, useState } from "react";
import { COLORS } from "./atoms";

/**
 * The game's own artwork, like SCSKiller's table: the Steam "logo" when the game has one,
 * then the client icon (its hash comes from this Steam client), then a capsule, then a
 * letter tile when the game has no Steam assets at all.
 */

const CDN = "https://cdn.akamai.steamstatic.com/steam/apps";
const ICON_CDN = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps";

function logoUrls(appid?: number | null): string[] {
  if (!appid || !isFinite(appid) || appid <= 0) return [];
  const urls = [`${CDN}/${appid}/logo.png`];
  try {
    const overview = (window as any).appStore?.GetAppOverviewByAppID?.(appid);
    const hash = overview?.icon_hash;
    if (typeof hash === "string" && hash) urls.push(`${ICON_CDN}/${appid}/${hash}.jpg`);
  } catch {
    // no Steam app store in this context: the CDN fallbacks still work
  }
  urls.push(`${CDN}/${appid}/capsule_231x87.jpg`);
  return urls;
}

const TILE_COLORS = ["#2a4d69", "#4b3b6b", "#6b3b3b", "#3b6b52", "#5c4a2a", "#33475b"];

function tileColor(name: string): string {
  let sum = 0;
  for (let index = 0; index < name.length; index += 1) sum = (sum * 31 + name.charCodeAt(index)) % 100000;
  return TILE_COLORS[sum % TILE_COLORS.length];
}

function Tile({ name, size }: { name?: string; size: number }) {
  const letter = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: 3,
        background: tileColor(name || ""),
        color: COLORS.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.46),
        fontWeight: 700,
        opacity: 0.9,
      }}
    >
      {letter}
    </div>
  );
}

export function GameLogo({ appid, name, size = 36 }: { appid?: number | null; name?: string; size?: number }) {
  const urls = useMemo(() => logoUrls(appid), [appid]);
  const [index, setIndex] = useState(0);

  if (urls.length === 0 || index >= urls.length) return <Tile name={name} size={size} />;

  return (
    <div
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: 3,
        background: COLORS.surface,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <img
        src={urls[index]}
        alt=""
        draggable={false}
        onError={() => setIndex((current) => current + 1)}
        style={{ maxWidth: "92%", maxHeight: "92%", objectFit: "contain", display: "block" }}
      />
    </div>
  );
}
