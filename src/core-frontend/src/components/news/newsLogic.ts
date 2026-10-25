import type { NewsAction, NewsCategory, NewsChange, NewsChangeKind, NewsGalleryItem, NewsPayload, PublicNews } from '../../api';
import { gameGradient } from '../../games';
import { coverBackground } from '../../cover';

/** pure helpers of the public news pages (kept free of React so they are easy to test) */

export const NEWS_CATEGORIES: NewsCategory[] = ['announcement', 'wipe', 'update', 'event', 'maintenance', 'other'];
/** categories shown as rubric chips (besides «Все»); «other» is only counted under «Все» */
export const RUBRICS: NewsCategory[] = ['announcement', 'wipe', 'update', 'event', 'maintenance'];

export const CATEGORY_LABEL_RU: Record<NewsCategory, string> = {
  announcement: 'Объявления',
  wipe: 'Вайпы',
  update: 'Обновления',
  event: 'Ивенты',
  maintenance: 'Обслуживание',
  other: 'Другое',
};
/** accent used in default cover gradients */
export const CATEGORY_HEX: Record<NewsCategory, string> = {
  announcement: '#5b4fe0',
  wipe: '#ea580c',
  update: '#16a34a',
  event: '#db2777',
  maintenance: '#ca8a04',
  other: '#64748b',
};

export const normCategory = (c: unknown): NewsCategory =>
  typeof c === 'string' && (NEWS_CATEGORIES as string[]).includes(c) ? (c as NewsCategory) : 'announcement';

/** category of a feed item: the item field first, then the payload, default «announcement» */
export const categoryOf = (n: Pick<PublicNews, 'category' | 'payload'>): NewsCategory => normCategory(n.category ?? n.payload?.category);
export const isPinned = (n: Pick<PublicNews, 'pinned' | 'payload'>): boolean => !!(n.pinned ?? n.payload?.pinned);

/** pinned first, then the newest; a stable order for equal timestamps */
export function orderFeed<T extends Pick<PublicNews, 'id' | 'sentAt' | 'pinned' | 'payload'>>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const pa = isPinned(a) ? 1 : 0;
    const pb = isPinned(b) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const d = (b.sentAt ?? 0) - (a.sentAt ?? 0);
    return d !== 0 ? d : b.id - a.id;
  });
}

export type RubricFilter = 'all' | NewsCategory;

export function countByCategory(items: Pick<PublicNews, 'category' | 'payload'>[]): Record<RubricFilter, number> {
  const out = { all: items.length, announcement: 0, wipe: 0, update: 0, event: 0, maintenance: 0, other: 0 } as Record<RubricFilter, number>;
  for (const n of items) out[categoryOf(n)]++;
  return out;
}

/**
 * Rubrics worth showing as chips: the ones that have news (and the one that is selected, so it can be switched off).
 * With fewer than two non-empty rubrics there is nothing to filter and the whole row is hidden.
 */
export function visibleRubrics(counts: Record<RubricFilter, number>, current: RubricFilter): NewsCategory[] {
  const filled = RUBRICS.filter((r) => counts[r] > 0);
  if (filled.length < 2 && current === 'all') return [];
  return RUBRICS.filter((r) => counts[r] > 0 || r === current);
}

export function filterByCategory<T extends Pick<PublicNews, 'category' | 'payload'>>(items: T[], f: RubricFilter): T[] {
  return f === 'all' ? items : items.filter((n) => categoryOf(n) === f);
}

export const isRubricFilter = (v: unknown): v is RubricFilter => v === 'all' || (typeof v === 'string' && (NEWS_CATEGORIES as string[]).includes(v));

// ---------- grouping by month ----------
export interface MonthGroup<T> { key: string; label: string; items: T[] }

/** items must already be in the order to show; groups follow the order of first appearance. `monthName` is injected for tests. */
export function groupByMonth<T extends { sentAt: number | null }>(
  items: T[],
  monthName: (year: number, month: number) => string = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`,
  utc = false,
): MonthGroup<T>[] {
  const groups: MonthGroup<T>[] = [];
  const idx = new Map<string, MonthGroup<T>>();
  for (const it of items) {
    let key = 'none';
    let label = '';
    if (it.sentAt) {
      const d = new Date(it.sentAt);
      const y = utc ? d.getUTCFullYear() : d.getFullYear();
      const m = utc ? d.getUTCMonth() : d.getMonth();
      key = `${y}-${String(m + 1).padStart(2, '0')}`;
      label = monthName(y, m);
    }
    let g = idx.get(key);
    if (!g) {
      g = { key, label, items: [] };
      idx.set(key, g);
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}

// ---------- countdown ----------
export interface CountdownParts { d: number; h: number; m: number; s: number; done: boolean }

export function countdownParts(at: number, now: number): CountdownParts {
  const left = Math.max(0, Math.floor((at - now) / 1000));
  return { d: Math.floor(left / 86400), h: Math.floor((left % 86400) / 3600), m: Math.floor((left % 3600) / 60), s: left % 60, done: at - now <= 0 };
}

const UNITS = {
  ru: { d: 'д', h: 'ч', m: 'мин', s: 'с', in: 'через', started: 'Началось', inNoLabel: 'Через' },
  en: { d: 'd', h: 'h', m: 'min', s: 's', in: 'in', started: 'Started', inNoLabel: 'In' },
} as const;

/** «2 д 4 ч 10 мин»; seconds only when under an hour is left */
export function countdownDuration(at: number, now: number, lang: 'ru' | 'en' = 'ru'): string {
  const u = UNITS[lang];
  const p = countdownParts(at, now);
  const out: string[] = [];
  if (p.d) out.push(`${p.d} ${u.d}`);
  if (p.d || p.h) out.push(`${p.h} ${u.h}`);
  out.push(`${p.m} ${u.m}`);
  if (!p.d && !p.h) out.push(`${p.s} ${u.s}`);
  return out.join(' ');
}

/** «Вайп через 2 д 4 ч 10 мин»; after the moment: «Началось» */
export function countdownText(at: number, now: number, label = '', lang: 'ru' | 'en' = 'ru'): string {
  const u = UNITS[lang];
  const l = label.trim();
  if (at - now <= 0) return u.started;
  const dur = countdownDuration(at, now, lang);
  return l ? `${l} ${u.in} ${dur}` : `${u.inNoLabel} ${dur}`;
}

// ---------- covers ----------
export interface CoverInput {
  game?: string | null;
  statusServerIds?: number[];
  servers?: { id: number; game: string }[] | null;
  category?: NewsCategory;
}

/** the game of the cover: payload.game, else the game of the first status server, else '' */
export function coverGame(i: CoverInput): string {
  if (i.game) return i.game;
  const first = i.statusServerIds?.[0];
  if (first != null) {
    const s = i.servers?.find((x) => x.id === first);
    if (s?.game) return s.game;
  }
  return '';
}

/** a gradient for a news without a picture: the game's colours, else the category's */
export function coverGradient(i: CoverInput): string {
  const g = coverGame(i);
  if (g) {
    const [a, b] = gameGradient(g);
    return `linear-gradient(135deg, ${a}, ${b})`;
  }
  const c = CATEGORY_HEX[normCategory(i.category)];
  return `linear-gradient(135deg, color-mix(in srgb, ${c} 82%, #000), ${c})`;
}

/**
 * True when a news has neither a picture nor a game: its cover is drawn by the panel (a mesh in the colour of the
 * rubric with the rubric's pictogram) instead of a flat gradient.
 */
export function isGeneratedCover(i: CoverInput & { image?: string | null }): boolean {
  return !i.image && !coverGame(i);
}

/** a heading of a news text: the line it sits on (also the id suffix on the page), its level and its text */
export interface Heading { id: string; level: 1 | 2 | 3; text: string }

/** `# `, `## `, `### ` lines outside code blocks; the id is `nw-h-<line index>` (DiscordMd puts the same id on the line) */
export function extractHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  let fenced = false;
  text.split('\n').forEach((line, i) => {
    if (line.trim().startsWith('```')) {
      // a single-line ```code``` neither opens nor closes a block
      if (!/^```.*```$/.test(line.trim())) fenced = !fenced;
      return;
    }
    if (fenced) return;
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h && h[2].trim()) out.push({ id: `nw-h-${i}`, level: h[1].length as 1 | 2 | 3, text: h[2].replace(/[*_~`|]/g, '').trim() });
  });
  return out;
}

/** up to `n` other news to read next: the same rubric first, then the newest ones */
export function relatedNews<T extends Pick<PublicNews, 'id' | 'sentAt' | 'category' | 'payload'>>(items: T[], currentId: number, category: NewsCategory, n = 3): T[] {
  const rest = items.filter((x) => x.id !== currentId).sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
  const same = rest.filter((x) => categoryOf(x) === category);
  return [...same, ...rest.filter((x) => !same.includes(x))].slice(0, n);
}

/** CSS `background` of the default cover (the game's artwork when it ships one, else the gradient) */
export function defaultCoverBackground(i: CoverInput, small = false): string {
  return coverBackground(null, coverGradient(i), { game: coverGame(i), small, strong: true });
}

/** the picture of a news item: big embed image, then the first gallery picture, then the thumbnail */
export function newsImage(p: NewsPayload): string | null {
  const e = p.embed;
  if (e?.image?.upload) return `/api/news/images/${e.image.upload}`;
  if (e?.image?.url && /^https?:\/\//i.test(e.image.url)) return e.image.url;
  const g = galleryUrls(p.gallery)[0];
  if (g) return g;
  if (e?.thumbnailUrl && /^https?:\/\//i.test(e.thumbnailUrl)) return e.thumbnailUrl;
  return null;
}

export function galleryUrls(g: NewsGalleryItem[] | undefined | null): string[] {
  if (!Array.isArray(g)) return [];
  const out: string[] = [];
  for (const it of g) {
    if (!it) continue;
    if (it.upload) out.push(`/api/news/images/${it.upload}`);
    else if (it.url && /^https?:\/\//i.test(it.url)) out.push(it.url);
    if (out.length >= 6) break;
  }
  return out;
}

// ---------- changes / actions ----------
export const CHANGE_ORDER: NewsChangeKind[] = ['add', 'fix', 'change', 'remove'];
export const CHANGE_LABEL_RU: Record<NewsChangeKind, string> = { add: 'Добавлено', fix: 'Исправлено', change: 'Изменено', remove: 'Удалено' };

export const isChangeKind = (k: unknown): k is NewsChangeKind => k === 'add' || k === 'fix' || k === 'remove' || k === 'change';

/** groups in the fixed order (добавлено, исправлено, изменено, удалено); empty texts and unknown kinds are dropped */
export function groupChanges(changes: NewsChange[] | undefined | null): { kind: NewsChangeKind; items: string[] }[] {
  if (!Array.isArray(changes)) return [];
  const by = new Map<NewsChangeKind, string[]>();
  for (const c of changes) {
    const text = typeof c?.text === 'string' ? c.text.trim() : '';
    if (!text) continue;
    const kind = isChangeKind(c.kind) ? c.kind : 'change';
    by.set(kind, [...(by.get(kind) ?? []), text]);
  }
  return CHANGE_ORDER.filter((k) => by.has(k)).map((k) => ({ kind: k, items: by.get(k)! }));
}

export const isHttpsUrl = (u: string) => {
  try {
    return new URL(u.trim()).protocol === 'https:';
  } catch {
    return false;
  }
};

/** only actions with a label and an https link, at most three */
export function validActions(a: NewsAction[] | undefined | null): NewsAction[] {
  if (!Array.isArray(a)) return [];
  return a.filter((x) => x && typeof x.label === 'string' && x.label.trim() && typeof x.url === 'string' && isHttpsUrl(x.url)).slice(0, 3).map((x) => ({ label: x.label.trim(), url: x.url.trim() }));
}

/** plain-text preview of markdown-ish text (list cards) */
/** minutes to read a text (about 200 words a minute), at least 1; 0 for a text too short to mention */
export function readingMinutes(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words < 60 ? 0 : Math.max(1, Math.round(words / 200));
}

export function plainExcerpt(text: string, max = 180): string {
  // list items keep a bullet between them (otherwise «- a - b» runs together with stray hyphens)
  const s = text.replace(/```[\s\S]*?```/g, ' ').replace(/^[ \t]*[-*•]\s+/gm, '• ').replace(/[*_~`>#|]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// ---------- reactions ----------
export const REACTION_EMOJIS = ['👍', '🔥', '❤️', '😮'] as const;

/** all four emojis in a fixed order, with counts (missing = 0) */
export function fullReactions(list: { emoji: string; count: number; mine: boolean }[] | undefined | null): { emoji: string; count: number; mine: boolean }[] {
  const by = new Map((Array.isArray(list) ? list : []).map((r) => [r.emoji, r]));
  return REACTION_EMOJIS.map((e) => ({ emoji: e as string, count: Math.max(0, by.get(e)?.count ?? 0), mine: !!by.get(e)?.mine }));
}

/** optimistic update: one reaction per user; clicking your own reaction removes it. `next` is the value to send. */
export function toggleReaction(
  list: { emoji: string; count: number; mine: boolean }[] | undefined | null,
  emoji: string,
): { list: { emoji: string; count: number; mine: boolean }[]; next: string | null } {
  const cur = fullReactions(list);
  const was = cur.find((r) => r.mine)?.emoji ?? null;
  const next = was === emoji ? null : emoji;
  return {
    next,
    list: cur.map((r) => {
      let count = r.count;
      if (r.emoji === was) count = Math.max(0, count - 1);
      if (r.emoji === next) count += 1;
      return { ...r, count, mine: r.emoji === next };
    }),
  };
}

// ---------- «Новое»: what was published since the person last opened the news ----------

/** a published item is fresh when it came after the last visit (no stored visit yet: nothing is fresh) */
export const isFresh = (sentAt: number | null | undefined, seen: number | null): boolean => seen != null && sentAt != null && sentAt > seen;

export const unreadCount = (items: { sentAt: number | null }[], seen: number | null): number => items.filter((n) => isFresh(n.sentAt, seen)).length;

/** the item for the big block at the top of the feed: the newest pinned one, else the newest one; null for a short feed */
export function pickHero<T extends Pick<PublicNews, 'id' | 'sentAt' | 'pinned' | 'payload'>>(items: T[], min = 3): T | null {
  if (items.length < min) return null;
  const ordered = orderFeed(items);
  return ordered[0] ?? null;
}

/** «Обновлено» is shown only when the edit came well after the publication (not for a fix made a minute later) */
export const EDIT_GRACE_MS = 10 * 60_000;
export const wasEdited = (sentAt: number | null | undefined, editedAt: number | null | undefined): boolean =>
  sentAt != null && editedAt != null && editedAt - sentAt > EDIT_GRACE_MS;
