/**
 * Restart of a game server by a timer: «.restart 5m» in the game, «restart 5m» in the console of AMP, a button in the
 * panel, «/restart» in Discord. These are the parts that need no database: reading the time a person typed, saying the
 * time left in Russian, and deciding when the next «через N минут» goes into the chat.
 */

import { PALETTE } from './gameNewsPalette.js';

export const MIN_SECONDS = 10;
export const MAX_SECONDS = 6 * 3600;

export type DurationResult = { seconds: number } | { error: 'format' | 'short' | 'long' };

const UNIT: Array<[RegExp, number]> = [
  [/^(?:s|sec|secs|second|seconds|с|сек|секунда|секунды|секунд|секунду)$/u, 1],
  [/^(?:m|min|mins|minute|minutes|м|мин|минута|минуты|минут|минуту)$/u, 60],
  [/^(?:h|hr|hrs|hour|hours|ч|час|часа|часов)$/u, 3600],
];

/**
 * «5m», «5м», «5 мин», «30s», «30с», «1h», «1ч», «1h30m», «90» (a bare number is minutes) -> seconds.
 * Not shorter than 10 seconds and not longer than 6 hours.
 */
export function parseDuration(input: string): DurationResult {
  const s = input.trim().toLowerCase().replace(/,/g, '.');
  if (!s) return { error: 'format' };
  let total = 0;
  let rest = s;
  let any = false;
  while (rest.length) {
    const m = /^(\d+(?:\.\d+)?)\s*([a-zа-яё]*)\s*/u.exec(rest);
    if (!m) return { error: 'format' };
    const n = Number(m[1]);
    const unit = m[2] === '' ? 60 : UNIT.find(([re]) => re.test(m[2]))?.[1];
    if (unit === undefined || !Number.isFinite(n)) return { error: 'format' };
    total += n * unit;
    rest = rest.slice(m[0].length);
    any = true;
  }
  if (!any) return { error: 'format' };
  const seconds = Math.round(total);
  if (seconds < MIN_SECONDS) return { error: 'short' };
  if (seconds > MAX_SECONDS) return { error: 'long' };
  return { seconds };
}

const plural = (n: number, one: string, few: string, many: string): string => {
  const m100 = n % 100;
  const m10 = n % 10;
  if (m100 >= 11 && m100 <= 14) return `${n} ${many}`;
  if (m10 === 1) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
};

/** «5 минут», «1 минуту», «4 минуты», «30 секунд», «1 час 30 минут» (the form that follows «через») */
export function formatLeft(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(plural(h, 'час', 'часа', 'часов'));
  if (m) parts.push(plural(m, 'минуту', 'минуты', 'минут'));
  if (sec || parts.length === 0) parts.push(plural(sec, 'секунду', 'секунды', 'секунд'));
  return parts.join(' ');
}

/** the moments (seconds left) at which the chat is told: every minute at the end, rarer when there is long to wait */
export const NOTICE_POINTS = [
  5, 10, 15, 30, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 900, 1200, 1800, 3600, 5400, 7200, 10800, 14400, 18000, 21600,
];

/**
 * The notice to give now, or null. `remaining` is the seconds left, `last` the point already announced (at the start, the
 * whole time). It is the smallest point not below what is left that has not been announced yet, so a late pass says the
 * nearest «через …» instead of a stale one.
 */
export function nextNotice(remaining: number, last: number): number | null {
  if (remaining <= 0) return null;
  const p = NOTICE_POINTS.find((x) => x >= remaining && x < last);
  return p === undefined ? null : p;
}

/** how the time is said in a notice: the point itself when we are close to it, else what is really left (rounded up to 5 s) */
export function noticeSeconds(point: number, remaining: number): number {
  return point - remaining <= 10 ? point : Math.ceil(remaining / 5) * 5;
}

export interface RestartTexts { announce: string; now: string; cancel: string }

export const DEFAULT_TEXTS: RestartTexts = {
  announce: '* Внимание! Рестарт сервера будет произведен через {time}.',
  now: '* Внимание! Сервер перезапускается. Вернитесь через пару минут.',
  cancel: '* Рестарт сервера отменён.',
};

const WARN: string = PALETTE.info;
const ALERT: string = PALETTE.bad;
const OK: string = PALETTE.good;

const clean = (s: string): string => Array.from(s, (ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('').replace(/[<>]/g, '').trim();

/** the line for the chat: yellow, red for the last minute */
export function announceLine(texts: RestartTexts, seconds: number): string {
  const color = seconds <= 60 ? ALERT : WARN;
  const left = formatLeft(seconds);
  const [before, ...rest] = clean(texts.announce).split('{time}');
  if (rest.length === 0) return `<color=${color}>${before}</color>`;
  // the time is picked out in white bold, the rest keeps the colour of the line
  return `<color=${color}>${before}</color><color=#FFFFFF><b>${left}</b></color><color=${color}>${rest.join(left)}</color>`;
}
export const nowLine = (texts: RestartTexts): string => `<color=${ALERT}>${clean(texts.now)}</color>`;
export const cancelLine = (texts: RestartTexts): string => `<color=${OK}>${clean(texts.cancel)}</color>`;
