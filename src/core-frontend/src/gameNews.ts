/**
 * Game news: the editor text, the colours and the preview of how it looks in the in-game chat.
 * The same tag rules as the backend (core-backend/src/gamenews/gameNewsLogic.ts): only <color=#RRGGBB>, <b>, <i>.
 */

export const MAX_VISIBLE = 400;

export interface NewsServerInfo { id: number; name: string; address: string; game: string; supported: boolean; hasToken: boolean; lastSeen: number | null; online: boolean; pluginVersion: string }
export type NewsStatus = 'queued' | 'delivered' | 'expired' | 'failed';
export interface NewsLogRow { id: number; serverId: number | null; serverName: string; text: string; status: NewsStatus; error: string; sentBy: string; sentAt: number; deliveredAt: number | null }
export interface NewsSendResult { text: string; results: { serverId: number; serverName: string; queued: boolean; online: boolean; error: string }[] }

/** the lines to paste into BepInEx/config/CoreGSM.cfg of the game server */
export function pluginConfig(panelUrl: string, token: string): string {
  const selfSigned = /^https:\/\/(\d{1,3}\.){3}\d{1,3}(:|\/|$)/.test(panelUrl);
  return ['[Panel]', `Url = ${panelUrl}`, `Token = ${token}`, `AllowSelfSigned = ${selfSigned}`].join('\n');
}

export interface Swatch { id: string; hex: string }

/** the colours of the toolbar; `id` picks the caption in the locale (gn.c.<id>) */
export const SWATCHES: Swatch[] = [
  { id: 'info', hex: '#6EC1FF' },
  { id: 'good', hex: '#5FD068' },
  { id: 'warn', hex: '#FFCC33' },
  { id: 'danger', hex: '#FF5555' },
  { id: 'event', hex: '#B86BFF' },
  { id: 'gold', hex: '#FFB347' },
  { id: 'white', hex: '#FFFFFF' },
];

export const TEMPLATES: { id: string; text: (time: string) => string }[] = [
  { id: 'restart', text: (tm) => `<color=#FFCC33>Перезапуск сервера через ${tm}.</color> Сохраните прогресс и возвращайтесь через пару минут.` },
  { id: 'wipe', text: (tm) => `<color=#FF5555><b>Вайп</b></color> ${tm}. Подробности на сайте.` },
  { id: 'event', text: (tm) => `<color=#B86BFF><b>Событие</b></color> стартует ${tm}! Заходите на сервер.` },
  { id: 'maintenance', text: (tm) => `<color=#6EC1FF>Технические работы</color> ${tm}. Сервер может быть недоступен.` },
];

export type Seg = { text: string; color: string | null; bold: boolean; italic: boolean };

const TAG = /<(\/?)(color|b|i)(?:=(#[0-9a-fA-F]{6}))?>/gi;

/** the text with the tags cut out */
export function visibleText(raw: string): string {
  return raw.replace(/<[^>]*>/g, '');
}

/** splits the text into styled pieces for the preview (unknown tags are shown as plain text without the angle brackets) */
export function parseNews(raw: string): Seg[] {
  const segs: Seg[] = [];
  const colors: string[] = [];
  let bold = 0;
  let italic = 0;
  let last = 0;
  const push = (t: string) => {
    // a tag the game would not draw is removed whole, like the backend does
    const text = t.replace(/<[^<>]*>/g, '').replace(/[<>]/g, '');
    if (text) segs.push({ text, color: colors.length ? colors[colors.length - 1] : null, bold: bold > 0, italic: italic > 0 });
  };
  for (const m of raw.matchAll(TAG)) {
    push(raw.slice(last, m.index));
    last = m.index + m[0].length;
    const close = m[1] === '/';
    const name = m[2].toLowerCase();
    if (name === 'color') { if (close) colors.pop(); else if (m[3]) colors.push(m[3].toUpperCase()); }
    else if (name === 'b') bold = Math.max(0, bold + (close ? -1 : 1));
    else italic = Math.max(0, italic + (close ? -1 : 1));
  }
  push(raw.slice(last));
  return segs;
}

/** wraps text[start, end) into a tag; returns the new text and where the selection should be */
export function wrapSelection(text: string, start: number, end: number, open: string, close: string): { text: string; start: number; end: number } {
  const a = Math.max(0, Math.min(start, end));
  const b = Math.max(a, Math.max(start, end));
  const sel = text.slice(a, b) || '…';
  const out = text.slice(0, a) + open + sel + close + text.slice(b);
  return { text: out, start: a + open.length, end: a + open.length + sel.length };
}

export const colorOpen = (hex: string): string => `<color=${hex.toUpperCase()}>`;
export const isHex = (s: string): boolean => /^#[0-9a-fA-F]{6}$/.test(s);

/** whether the author left a tag open (the backend closes it, the editor only warns) */
export function unbalanced(raw: string): boolean {
  const depth: Record<string, number> = { color: 0, b: 0, i: 0 };
  for (const m of raw.matchAll(TAG)) {
    const n = m[2].toLowerCase();
    depth[n] += m[1] === '/' ? -1 : 1;
    if (depth[n] < 0) return true;
  }
  return depth.color !== 0 || depth.b !== 0 || depth.i !== 0;
}

export function validateNews(raw: string): string | null {
  const v = visibleText(raw).trim();
  if (!v) return 'empty';
  if (v.length > MAX_VISIBLE) return 'long';
  return null;
}

export type RuleKind = 'interval' | 'daily' | 'once';

/** an automatic announcement as the panel returns it */
export interface RuleInfo {
  id: number;
  name: string;
  text: string;
  /** [] = every server that has a plugin */
  serverIds: number[];
  kind: RuleKind;
  everyMin: number;
  times: string[];
  runAt: number | null;
  activeFrom: number | null;
  activeTo: number | null;
  onlyOnline: boolean;
  enabled: boolean;
  lastRun: number | null;
  nextRun: number | null;
  createdBy: string;
  /** the next runs (up to 5) of an enabled rule */
  upcoming: number[];
}

export type RuleBody = Omit<RuleInfo, 'id' | 'lastRun' | 'nextRun' | 'createdBy' | 'upcoming'>;

export const INTERVAL_PRESETS = [15, 30, 60, 120, 360];
export const MIN_EVERY = 5;
export const MAX_EVERY = 10_080;

export const isHHMM = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export const emptyRule = (): RuleBody => ({
  name: '', text: '', serverIds: [], kind: 'interval', everyMin: 60, times: ['20:00'], runAt: null,
  activeFrom: null, activeTo: null, onlyOnline: true, enabled: true,
});

/** what is wrong with a rule (a key part of the message), or null */
export function validateRule(r: RuleBody, now: number): 'name' | 'text' | 'every' | 'times' | 'runAt' | 'period' | null {
  if (!r.name.trim()) return 'name';
  if (validateNews(r.text)) return 'text';
  if (r.kind === 'interval' && (!Number.isInteger(r.everyMin) || r.everyMin < MIN_EVERY || r.everyMin > MAX_EVERY)) return 'every';
  if (r.kind === 'daily' && (!r.times.length || !r.times.every(isHHMM))) return 'times';
  if (r.kind === 'once' && (r.runAt == null || r.runAt <= now)) return 'runAt';
  if (r.activeFrom != null && r.activeTo != null && r.activeTo < r.activeFrom) return 'period';
  return null;
}

/** true when version `a` is older than `b` (numeric dotted versions: 0.2.0 < 0.10.1); an unknown version counts as older */
export function versionLess(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => parseInt(x, 10));
  const pb = b.split('.').map((x) => parseInt(x, 10));
  if (!a || pa.some(Number.isNaN)) return true;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** the variables the panel fills in for each server when it sends */
export const VARIABLES = ['server', 'online', 'max', 'time'] as const;
const SAMPLE: Record<(typeof VARIABLES)[number], string> = { server: 'Мой сервер', online: '12', max: '40', time: '20:00' };

/** the variables of the greeting: {name} is the nickname of the joining player (the plugin fills it in) */
export const WELCOME_VARIABLES = ['name', 'server'] as const;

/** the preview shows sample values for the variables ({name} only in a greeting) */
export function fillSample(text: string, welcome = false): string {
  const s = text.replace(/\{(server|online|max|time)\}/g, (_m, k: (typeof VARIABLES)[number]) => SAMPLE[k]);
  return welcome ? s.replace(/\{name\}/g, 'Игрок') : s;
}
