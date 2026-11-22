/**
 * Diagnostics for the QAM panel: whether the game-page button was spliced in, and
 * where. Written from the route patch (render path), read by the panel on a timer.
 */
export const diagnostics: {
  injected: boolean;
  detail: string;
  appid: number;
} = {
  injected: false,
  detail: "waiting for a game page",
  appid: 0,
};
