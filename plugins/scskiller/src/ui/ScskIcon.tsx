/** The small SCSKiller badge: a shader bolt inside a hexagon (a stand-in for the app's logo). */
export function ScskIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
      <path
        d="M12 2.7 20 7.2v9.6L12 21.3 4 16.8V7.2L12 2.7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        opacity="0.85"
      />
      <path d="M13.1 6.4 8.2 13.1h3.2l-.9 4.5 4.9-6.9h-3.1l.8-4.3Z" fill="currentColor" />
    </svg>
  );
}
