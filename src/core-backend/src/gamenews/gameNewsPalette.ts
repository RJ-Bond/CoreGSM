/**
 * The colours of the lines that a player reads in the game, in one place. The panel builds most lines itself; the plugin gets the same
 * set in the answer of every poll (`palette`) for the few lines that it writes (usage, progress, errors), so the two never drift apart.
 * No imports here: the pure parts of the panel (the restart lines) use it too.
 */
export const PALETTE = {
  /** a nickname, a hint, a command: yellow */
  info: '#FFCC33',
  /** good news, a date, a time: green */
  good: '#5FD068',
  /** a refusal, an error, a ban: red */
  bad: '#FF5555',
  /** progress, the Discord hint: sky blue */
  hint: '#6EC1FF',
  /** quiet words: grey */
  muted: '#9AA3AE',
  /** the arguments in a usage line */
  arg: '#7FD6FF',
} as const;

export type Palette = Record<keyof typeof PALETTE, string>;
