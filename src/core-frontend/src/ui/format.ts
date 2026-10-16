/** Dates, times and plural forms in the panel's language and time zone. */
import { getPrefs, t } from '../i18n';

// ---------- formatting ----------
// Dates and times honour the user's regional settings (time zone, 12/24 h, date order): see «Оформление и регион».
export const ago = (ts: number | null) => {
  if (!ts) return '–';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return t('ago.s', { n: s });
  if (s < 3600) return t('ago.m', { n: Math.floor(s / 60) });
  if (s < 86400) return t('ago.h', { n: Math.floor(s / 3600) });
  return t('ago.d', { n: Math.floor(s / 86400) });
};

const dtfCache = new Map<string, Intl.DateTimeFormat>();
const zonedFormatter = (tz: string): Intl.DateTimeFormat => {
  let f = dtfCache.get(tz);
  if (!f) {
    const base: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
    try {
      f = new Intl.DateTimeFormat('en-US', { ...base, timeZone: tz || undefined });
    } catch {
      f = new Intl.DateTimeFormat('en-US', base);
    }
    dtfCache.set(tz, f);
  }
  return f;
};

/** calendar fields of a moment in the chosen time zone */
function zoned(ts: number) {
  const o: Record<string, string> = {};
  for (const p of zonedFormatter(getPrefs().timezone).formatToParts(ts)) o[p.type] = p.value;
  return { y: o.year, m: o.month, d: o.day, h: Number(o.hour) % 24, mi: o.minute, s: o.second };
}

const fmtYmd = (y: string, m: string, d: string) => {
  const f = getPrefs().dateFormat;
  return f === 'iso' ? `${y}-${m}-${d}` : f === 'mdy' ? `${m}/${d}/${y}` : `${d}.${m}.${y}`;
};

const validTs = (ts: number | null | undefined): ts is number => typeof ts === 'number' && Number.isFinite(ts);

/** «13.10.2026» / «10/13/2026» / «2026-10-13» */
export const fmtDate = (ts: number) => {
  if (!validTs(ts)) return '–';
  const z = zoned(ts);
  return fmtYmd(z.y, z.m, z.d);
};

/** «14:05» or «2:05 PM» */
export const fmtTime = (ts: number, seconds = false) => {
  if (!validTs(ts)) return '–';
  const z = zoned(ts);
  const sec = seconds ? `:${z.s}` : '';
  if (getPrefs().timeFormat === '12') {
    const h12 = z.h % 12 === 0 ? 12 : z.h % 12;
    return `${h12}:${z.mi}${sec} ${z.h < 12 ? 'AM' : 'PM'}`;
  }
  return `${String(z.h).padStart(2, '0')}:${z.mi}${sec}`;
};

export const fmtDateTime = (ts: number) => (validTs(ts) ? `${fmtDate(ts)}, ${fmtTime(ts)}` : '–');

/** a plain calendar day "YYYY-MM-DD" (no time zone conversion) in the chosen date format */
export const fmtDay = (day: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? fmtYmd(m[1], m[2], m[3]) : day;
};

/** plural(5, ['сервер', 'сервера', 'серверов']) -> "серверов" */
export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
}

const numFmt = new Map<string, Intl.NumberFormat>();
/** a number in the panel's language: «99,8» in Russian, «99.8» in English; up to `digits` decimals */
export const num = (n: number | null | undefined, digits = 1): string => {
  if (n == null || !Number.isFinite(n)) return '–';
  const loc = `${getPrefs().lang === 'en' ? 'en-US' : 'ru-RU'}|${digits}`;
  let f = numFmt.get(loc);
  if (!f) numFmt.set(loc, (f = new Intl.NumberFormat(loc.split('|')[0], { maximumFractionDigits: digits })));
  return f.format(n);
};
