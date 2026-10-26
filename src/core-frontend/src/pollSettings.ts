/** Poll settings («Опрос серверов»): types and pure helpers. */

export interface PollLast { at: number; durationMs: number; servers: number; failures: number; concurrency: number }
export interface PollRule { n: number; m: number; probeVeto: boolean; custom: boolean }
export interface PollSettings {
  failThreshold: number;
  concurrency: number;
  /** rule «N of M»: null = not set, the consecutive-failure threshold decides */
  failN?: number | null;
  failM?: number | null;
  probeVeto?: boolean;
  rule?: PollRule;
  last: PollLast | null;
}

export const FAIL_MIN = 1;
export const FAIL_MAX = 5;
export const CONC_MIN = 1;
export const CONC_MAX = 32;
export const WINDOW_MAX = 20;

/** the first problem with the two numbers, or null */
export function validatePoll(v: { failThreshold: number; concurrency: number; failN?: number | null; failM?: number | null }): string | null {
  if (!Number.isInteger(v.failThreshold) || v.failThreshold < FAIL_MIN || v.failThreshold > FAIL_MAX) return `Число неудачных опросов: от ${FAIL_MIN} до ${FAIL_MAX}`;
  if (!Number.isInteger(v.concurrency) || v.concurrency < CONC_MIN || v.concurrency > CONC_MAX) return `Параллельных опросов: от ${CONC_MIN} до ${CONC_MAX}`;
  for (const x of [v.failN, v.failM]) {
    if (x !== null && x !== undefined && (!Number.isInteger(x) || x < 1 || x > WINDOW_MAX)) return `Правило «N из M»: числа от 1 до ${WINDOW_MAX} (или оставьте поля пустыми)`;
  }
  return null;
}

/** the sentence under the «N of M» fields */
export function ruleText(n: number | null, m: number | null, threshold: number): string {
  if (n === null && m === null) return `Правило не задано: сбой подтверждается ${confirmDelayText(threshold)}.`;
  const mm = m ?? Math.max(threshold, n ?? threshold);
  const nn = Math.min(n ?? Math.min(threshold, mm), mm);
  return `Сервер считается упавшим, если не ответил ${nn} из последних ${mm} опросов (необязательно подряд).`;
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
