import { useSyncExternalStore } from 'react';
import { api, getToken, type Prefs } from './api';
import ru from './locales/ru';
import en from './locales/en';

/**
 * Language and regional settings.
 *
 * - `t('key', { n: 3 })`: typed key lookup; Russian is the source language and the fallback. A string may hold plural forms
 *   separated by "|" ("{n} сервер|{n} сервера|{n} серверов"); they are picked when `params.n` is a number (ru: 3 forms, en: 2).
 * - `useI18n()` re-renders the component when the language or any regional setting changes.
 * - the choice is kept in localStorage (so it applies before sign-in) and, for a signed-in user, in /me/prefs.
 *
 * Translated: header and navigation, sign-in / registration, profile, public profile, shared buttons and toasts.
 * Other pages (servers, admin, news, status ...) stay Russian.
 */
export type Lang = Prefs['lang'];
export type { Prefs };
export type TKey = keyof typeof ru;

const dicts: Record<Lang, Record<TKey, string>> = { ru, en };

const STORE = 'coregsm_prefs';
export const DEFAULT_PREFS: Prefs = { lang: 'ru', timezone: '', timeFormat: '24', dateFormat: 'dmy' };

/** accepts anything (a stored string, a server answer) and returns a complete, valid Prefs */
export function normalizePrefs(raw: unknown, base: Prefs = DEFAULT_PREFS): Prefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    lang: r.lang === 'en' || r.lang === 'ru' ? r.lang : base.lang,
    timezone: typeof r.timezone === 'string' && r.timezone.length <= 64 ? r.timezone : base.timezone,
    timeFormat: r.timeFormat === '12' || r.timeFormat === '24' ? r.timeFormat : base.timeFormat,
    dateFormat: r.dateFormat === 'mdy' || r.dateFormat === 'iso' || r.dateFormat === 'dmy' ? r.dateFormat : base.dateFormat,
  };
}

const read = (): Prefs => {
  try {
    const s = localStorage.getItem(STORE);
    return s ? normalizePrefs(JSON.parse(s)) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
};

let current: Prefs = typeof window === 'undefined' ? DEFAULT_PREFS : read();
const listeners = new Set<() => void>();

const paintHtmlLang = () => {
  if (typeof document !== 'undefined') document.documentElement.lang = current.lang;
};
paintHtmlLang();

export const getPrefs = (): Prefs => current;
export const getLang = (): Lang => current.lang;

function commit(next: Prefs) {
  if (next.lang === current.lang && next.timezone === current.timezone && next.timeFormat === current.timeFormat && next.dateFormat === current.dateFormat) return;
  current = next;
  try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* private mode: not remembered */ }
  paintHtmlLang();
  listeners.forEach((l) => l());
}

/** take the settings from the server (/me) without writing them back */
export function applyServerPrefs(p: Partial<Prefs> | null | undefined) {
  if (!p) return;
  commit(normalizePrefs(p, current));
}

/** change settings here and, when signed in, on the server; the local change stands even when the request fails */
export async function updatePrefs(patch: Partial<Prefs>): Promise<void> {
  commit(normalizePrefs({ ...current, ...patch }, current));
  if (!getToken()) return;
  await api<Prefs>('/me/prefs', 'PUT', current);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

function pickPlural(s: string, n: number, lang: Lang): string {
  const forms = s.split('|');
  if (forms.length < 2) return s;
  if (lang === 'ru' && forms.length >= 3) {
    const m10 = Math.abs(n) % 10;
    const m100 = Math.abs(n) % 100;
    if (m10 === 1 && m100 !== 11) return forms[0];
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
    return forms[2];
  }
  return n === 1 ? forms[0] : forms[1];
}

export function t(key: TKey, params?: Record<string, string | number>): string {
  const lang = current.lang;
  let s = dicts[lang][key] ?? ru[key] ?? String(key);
  if (params) {
    if (typeof params.n === 'number' && s.includes('|')) s = pickPlural(s, params.n, lang);
    s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
  } else if (s.includes('|') && /\{n\}/.test(s)) {
    s = s.split('|')[0];
  }
  return s;
}

/** the current settings; the component re-renders when they change */
export function useI18n() {
  const prefs = useSyncExternalStore(subscribe, getPrefs, getPrefs);
  return { t, lang: prefs.lang, prefs };
}
