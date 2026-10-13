import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { COUNTRIES } from '../../countries';
import { getPrefs } from '../../i18n';

export const SERVER_TABS = ['players', 'history', 'events', 'connect'] as const;
export type TabId = '' | (typeof SERVER_TABS)[number];

/** hash of a server page tab: '' = overview */
export const tabHref = (id: number, tab: TabId) => `#/servers/${id}${tab ? `/${tab}` : ''}`;

/** re-renders the caller every `ms` and returns the current time */
export function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/** stagger index for `.tile-in` */
export const stagger = (i: number): CSSProperties => ({ ['--i' as string]: i });

// ---------- country ----------
export const flagEmoji = (code: string): string =>
  /^[A-Za-z]{2}$/.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';

export function countryName(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '';
  const up = code.toUpperCase();
  try {
    const n = new Intl.DisplayNames(['ru'], { type: 'region' }).of(up);
    if (n && n !== up) return n;
  } catch {
    /* no Intl.DisplayNames */
  }
  return COUNTRIES.find(([c]) => c === up)?.[1] ?? up;
}

// ---------- mode guessed from the name ----------
export type Mode = 'PvE' | 'PvP' | 'PvPvE' | 'RP' | 'Hardcore' | 'Vanilla' | 'Modded';

// \b does not work for Cyrillic: the word borders are "not a letter or digit"
const W = (src: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, 'iu');
const MODE_RULES: [Mode, RegExp][] = [
  ['PvPvE', W('pvpve|pve\\s*[+/&]\\s*pvp|pvp\\s*[+/&]\\s*pve|пвпве|пвп\\s*[+/&]\\s*пве|пве\\s*[+/&]\\s*пвп')],
  ['PvE', W('pve|пве|пвэ')],
  ['PvP', W('pvp|пвп')],
  ['RP', W('rp|рп|roleplay|role-play|role\\s+play|ролевой|ролевая|ролевые|рол\\s*плей')],
  ['Hardcore', W('hardcore|хардкор\\p{L}*')],
  ['Modded', W('modded|mods?|modpack|модпак\\p{L}*|моды|модифицированн\\p{L}*')],
  ['Vanilla', W('vanilla|ванил\\p{L}*|ванн?ила')],
];

/** PvE / PvP / PvPvE / RP / Hardcore / Vanilla / Modded, or null when the name says nothing certain */
export function guessMode(name: string): Mode | null {
  for (const [mode, re] of MODE_RULES) if (re.test(name)) return mode;
  return null;
}

// ---------- players ----------
/** stable 0..359 hue of a nick (FNV-1a) */
export function nickHue(name: string): number {
  let h = 0x811c9dc5;
  for (const ch of name.trim().toLowerCase()) {
    h ^= ch.codePointAt(0) as number;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}

/** first visible character (or grapheme where the browser can split them) in upper case */
export function nickInitial(name: string): string {
  const s = name.trim();
  if (!s) return '?';
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (t: string) => Iterable<{ segment: string }> } }).Segmenter;
  let first = '';
  if (Seg) {
    for (const g of new Seg(undefined, { granularity: 'grapheme' }).segment(s)) { first = g.segment; break; }
  } else first = Array.from(s)[0] ?? '?';
  return first.toUpperCase();
}

/** "1 ч 12 мин" */
export function playedFor(since: number, now: number): string {
  const m = Math.max(0, Math.floor((now - since) / 60_000));
  if (m < 1) return 'меньше минуты';
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч ${m % 60} мин`;
  return `${Math.floor(h / 24)} д ${h % 24} ч`;
}

/** length of an outage: "3 мин", "1 ч 5 мин" */
export function fmtDuration(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} ч ${m % 60} мин` : `${h} ч`;
  return h % 24 ? `${Math.floor(h / 24)} д ${h % 24} ч` : `${Math.floor(h / 24)} д`;
}

export const NEWBIE_MS = 10 * 60_000;
export const VETERAN_MS = 2 * 3600_000;

// ---------- load / ping thresholds ----------
export type Tone = 'ok' | 'warn' | 'bad';

export function loadTone(pct: number): Tone {
  return pct >= 85 ? 'bad' : pct >= 50 ? 'warn' : 'ok';
}

/** <= 60 ms good, <= 120 ms ok, more is bad */
export function pingTone(ping: number): { tone: Tone; label: string } {
  if (ping <= 60) return { tone: 'ok', label: 'отличный' };
  if (ping <= 120) return { tone: 'warn', label: 'нормальный' };
  return { tone: 'bad', label: 'высокий' };
}

export const TONE_TEXT: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' };

/** «server-name-24h-20261013.png»: the date is the user's own calendar day (their time zone) */
export function exportFileName(title: string, hours: number, ts: number): string {
  const slug = (title || 'server').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '') || 'server';
  let day = '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: getPrefs().timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ts);
    const o: Record<string, string> = {};
    for (const p of parts) o[p.type] = p.value;
    day = `${o.year}${o.month}${o.day}`;
  } catch {
    const d = new Date(ts);
    day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }
  return `${slug}-${hours <= 24 ? '24h' : hours <= 168 ? '7d' : '30d'}-${day}.png`;
}


/** px from the top of the viewport where sticky blocks of a tab may start: just under the glass header and the tab bar */
export function useStickyTop(): number {
  const [top, setTop] = useState(120);
  useLayoutEffect(() => {
    const measure = () => {
      const bar = document.querySelector<HTMLElement>('.srv-tabbar');
      if (!bar) return;
      setTop(Math.round(parseFloat(bar.style.top || '0') + bar.getBoundingClientRect().height));
    };
    measure();
    const bar = document.querySelector<HTMLElement>('.srv-tabbar');
    const ro = typeof ResizeObserver !== 'undefined' && bar ? new ResizeObserver(measure) : null;
    if (ro && bar) ro.observe(bar);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  return top;
}
