/**
 * The colours of the stripe on the side of a Discord message: one meaning, one colour, in every message the panel posts
 * (the server card, an alert, the weekly digest, a poll). Discord draws the stripe on its own dark or light background,
 * so these are the same values Discord uses for its own green, amber, red and blurple, readable on both.
 */
export const COLORS = {
  /** online, restored, finished */
  ok: 0x23a55a,
  /** lag, a warning, something to watch */
  warn: 0xf0b232,
  /** offline, a failure */
  bad: 0xf23f42,
  /** information, a test, an open poll */
  info: 0x5865f2,
  /** no data yet */
  unknown: 0x5a4bd1,
} as const;
