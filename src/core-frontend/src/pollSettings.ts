/** Poll settings («Опрос серверов»): types and pure helpers. */

export interface PollLast { at: number; durationMs: number; servers: number; failures: number; concurrency: number }
export interface PollSettings { failThreshold: number; concurrency: number; last: PollLast | null }

export const FAIL_MIN = 1;
export const FAIL_MAX = 5;
export const CONC_MIN = 1;
export const CONC_MAX = 32;

/** the first problem with the two numbers, or null */
export function validatePoll(v: { failThreshold: number; concurrency: number }): string | null {
  if (!Number.isInteger(v.failThreshold) || v.failThreshold < FAIL_MIN || v.failThreshold > FAIL_MAX) return `Число неудачных опросов: от ${FAIL_MIN} до ${FAIL_MAX}`;
  if (!Number.isInteger(v.concurrency) || v.concurrency < CONC_MIN || v.concurrency > CONC_MAX) return `Параллельных опросов: от ${CONC_MIN} до ${CONC_MAX}`;
  return null;
}

/** 850 -> «0,9 с», 12400 -> «12 с», 95000 -> «1 мин 35 с» */
export function durationText(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  if (ms < 1000) return `${Math.round(ms)} мс`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1).replace('.', ',')} с`;
  if (s < 60) return `${Math.round(s)} с`;
  return `${Math.floor(s / 60)} мин ${Math.round(s % 60)} с`;
}

/** how long a confirmed failure takes to show, given the polling interval in seconds */
export function confirmDelayText(failThreshold: number): string {
  return failThreshold <= 1 ? 'сразу после первой неудачи' : `после ${failThreshold} неудачных опросов подряд`;
}
