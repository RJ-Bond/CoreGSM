/** Poll settings («Опрос серверов»): types and pure helpers. */
import { t } from './i18n';

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
  if (!Number.isInteger(v.failThreshold) || v.failThreshold < FAIL_MIN || v.failThreshold > FAIL_MAX) return t('d2.poll.e.fail', { a: FAIL_MIN, b: FAIL_MAX });
  if (!Number.isInteger(v.concurrency) || v.concurrency < CONC_MIN || v.concurrency > CONC_MAX) return t('d2.poll.e.conc', { a: CONC_MIN, b: CONC_MAX });
  for (const x of [v.failN, v.failM]) {
    if (x !== null && x !== undefined && (!Number.isInteger(x) || x < 1 || x > WINDOW_MAX)) return t('d2.poll.e.rule', { n: WINDOW_MAX });
  }
  return null;
}

/** the sentence under the «N of M» fields */
export function ruleText(n: number | null, m: number | null, threshold: number): string {
  if (n === null && m === null) return t('d2.poll.noRule', { when: confirmDelayText(threshold) });
  const mm = m ?? Math.max(threshold, n ?? threshold);
  const nn = Math.min(n ?? Math.min(threshold, mm), mm);
  return t('d2.poll.rule', { a: nn, b: mm });
}

/** 850 -> «0,9 с», 12400 -> «12 с», 95000 -> «1 мин 35 с» */
export function durationText(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  if (ms < 1000) return t('d2.bot.ms', { n: Math.round(ms) });
  const s = ms / 1000;
  if (s < 10) return t('dur.s', { n: s.toFixed(1).replace('.', ',') });
  if (s < 60) return t('dur.s', { n: Math.round(s) });
  return `${t('dur.m', { n: Math.floor(s / 60) })} ${t('dur.s', { n: Math.round(s % 60) })}`;
}

/** how long a confirmed failure takes to show, given the polling interval in seconds */
export function confirmDelayText(failThreshold: number): string {
  return failThreshold <= 1 ? t('d2.poll.right') : t('d2.poll.after', { n: failThreshold });
}
