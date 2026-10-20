import type { CSSProperties } from 'react';
import type { NewsAction, NewsCategory, NewsChange, NewsReaction, PublicNews, Server } from '../../api';
import { useI18n, t } from '../../i18n';
import { fmtDate } from '../../ui';
import { AuthorLine, CategoryChip, Countdown, NewsText, PinChip } from './NewsParts';
import { CategoryIcon } from './NewsIcons';
import {
  CATEGORY_HEX, categoryOf, defaultCoverBackground, galleryUrls, groupByMonth, isGeneratedCover, isPinned, newsImage, plainExcerpt,
} from './newsLogic';

export { PANEL_THEME } from './NewsParts';

export interface Card {
  id: number;
  title: string;
  text: string;
  author: { name: string; icon?: string } | null;
  role: 'admin' | 'moderator' | 'player' | null;
  image: string | null;
  link: string | null;
  accent: string;
  at: number | null;
  fields: { name: string; value: string }[];
  category: NewsCategory;
  pinned: boolean;
  gallery: string[];
  countdownAt: number | null;
  countdownLabel: string;
  changes: NewsChange[];
  actions: NewsAction[];
  statusIds: number[];
  game: string;
  reactions: NewsReaction[];
}

const hex = (n: number | undefined) => `#${(n ?? 0x5b4fe0).toString(16).padStart(6, '0')}`;

export function cardOf(n: PublicNews): Card {
  const p = n.payload ?? { content: '', mention: 'none' as const };
  const e = p.embed;
  const url = e?.url && /^https?:\/\//i.test(e.url) ? e.url : null;
  const at = typeof p.countdownAt === 'number' && Number.isFinite(p.countdownAt) && p.countdownAt > 0 ? p.countdownAt : null;
  return {
    id: n.id,
    title: e?.title || n.title || t('nw.untitled'),
    text: (e?.description || p.content || '').trim(),
    author: e?.author?.name ? { name: e.author.name, icon: e.author.iconUrl } : null,
    role: n.authorRole ?? null,
    image: newsImage(p),
    link: url,
    accent: hex(e?.color),
    at: n.sentAt,
    fields: (e?.fields ?? []).filter((f) => f.name && f.value).map((f) => ({ name: f.name, value: f.value })),
    category: categoryOf(n),
    pinned: isPinned(n),
    gallery: galleryUrls(p.gallery),
    countdownAt: at,
    countdownLabel: p.countdownLabel ?? '',
    changes: Array.isArray(p.changes) ? p.changes : [],
    actions: Array.isArray(p.actions) ? p.actions : [],
    statusIds: Array.isArray(p.statusServerIds) ? p.statusServerIds : [],
    game: typeof p.game === 'string' ? p.game : '',
    reactions: Array.isArray(n.reactions) ? n.reactions : [],
  };
}

/** background of a cover: the picture, else the default cover (game artwork or a gradient) */
export function coverStyle(c: Card, servers: Server[] | null | undefined, small = false): CSSProperties {
  if (c.image) return { backgroundImage: `url("${c.image}")` };
  return { background: defaultCoverBackground({ game: c.game, statusServerIds: c.statusIds, servers, category: c.category }, small) };
}

/** no picture and no game: the panel draws the cover itself (see .nw-gen in news-page.css) */
export const hasGeneratedCover = (c: Card, servers: Server[] | null | undefined): boolean =>
  isGeneratedCover({ image: c.image, game: c.game, statusServerIds: c.statusIds, servers });

/** the colour a generated cover is drawn in: the rubric's */
const genVars = (c: Card): CSSProperties => ({ ['--gen' as string]: CATEGORY_HEX[c.category] });

/** big cover with the title over a bottom gradient; used by the feed hero and by the news page */
export function NewsCover({ c, servers, as: H = 'h2', href, tall = false }: { c: Card; servers: Server[] | null | undefined; as?: 'h1' | 'h2'; href?: string; tall?: boolean }) {
  const gen = hasGeneratedCover(c, servers);
  return (
    <div className={`nw-cover ${tall ? 'is-tall' : ''} ${gen ? 'is-gen' : ''}`} style={{ ['--nf-accent' as string]: c.accent, ...(gen ? genVars(c) : {}) }}>
      <div className={`nw-cover-bg ${gen ? 'nw-gen' : ''}`} style={gen ? undefined : coverStyle(c, servers)} aria-hidden>
        {gen && <span className="nw-gen-ico"><CategoryIcon category={c.category} size={96} /></span>}
      </div>
      <div className="nw-cover-shade" aria-hidden />
      <div className="nw-cover-in">
        <div className="nw-cover-chips">
          {c.pinned && <PinChip />}
          <CategoryChip category={c.category} />
          {c.at && <span className="nw-chip nw-chip-date">{fmtDate(c.at)}</span>}
        </div>
        <H className="nw-cover-title">{href ? <a href={href}>{c.title}</a> : c.title}</H>
      </div>
    </div>
  );
}

function monthFormatter(lang: 'ru' | 'en') {
  const f = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'ru-RU', { month: 'long', year: 'numeric' });
  return (y: number, m: number) => {
    const s = f.format(new Date(y, m, 1)).replace(/\s*г\.$/, '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
}

/** the day and the short month for the date column of an entry: «18» / «окт» */
function dateParts(ts: number | null, lang: 'ru' | 'en'): { day: string; mon: string; year: string } | null {
  if (!ts) return null;
  const d = new Date(ts);
  const mon = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'ru-RU', { month: 'short' }).format(d).replace('.', '');
  return { day: String(d.getDate()), mon, year: String(d.getFullYear()) };
}

/** One entry of the editorial list: the date on the left, the rubric and a serif headline with a teaser, the cover on the right. */
function Entry({ c, servers, lang }: { c: Card; servers: Server[] | null | undefined; lang: 'ru' | 'en' }) {
  const href = `/news/${c.id}`;
  const gen = hasGeneratedCover(c, servers);
  const dp = dateParts(c.at, lang);
  return (
    <article className="ne" style={{ ['--nf-accent' as string]: c.accent }}>
      <div className="ne-date" aria-label={c.at ? fmtDate(c.at) : undefined}>
        {dp && <><b>{dp.day}</b><span>{dp.mon}</span><small>{dp.year}</small></>}
      </div>
      <div className="ne-body">
        <div className="nw-chips">
          {c.pinned && <PinChip />}
          <CategoryChip category={c.category} />
          {c.countdownAt && <Countdown at={c.countdownAt} label={c.countdownLabel} compact />}
        </div>
        <h3 className="ne-title"><a href={href}>{c.title}</a></h3>
        {c.text && <p className="ne-text">{plainExcerpt(c.text, 260)}</p>}
        <div className="ne-foot">
          {c.author && <AuthorLine name={c.author.name} icon={c.author.icon} role={c.role} />}
          <a className="nw-more" href={href}>{t('nw.readShort')}<span aria-hidden> →</span></a>
        </div>
      </div>
      <a className={`ne-cover ${gen ? 'nw-gen' : ''}`} href={href} style={gen ? genVars(c) : coverStyle(c, servers, true)} aria-label={c.title} tabIndex={-1}>
        {gen && <span className="nw-gen-ico"><CategoryIcon category={c.category} size={64} /></span>}
      </a>
    </article>
  );
}

export function Row({ c, servers }: { c: Card; servers: Server[] | null | undefined }) {
  const href = `/news/${c.id}`;
  const gen = hasGeneratedCover(c, servers);
  return (
    <article className="nf-item nw-item" style={{ ['--nf-accent' as string]: c.accent }}>
      <a className={`nf-thumb nw-thumb ${gen ? 'nw-gen' : ''}`} href={href} style={gen ? genVars(c) : coverStyle(c, servers, true)} aria-label={c.title} tabIndex={-1}>
        {gen && <span className="nw-gen-ico"><CategoryIcon category={c.category} size={64} /></span>}
      </a>
      <div className="nf-item-in">
        <div className="nw-chips">
          {c.pinned && <PinChip />}
          <CategoryChip category={c.category} />
          {c.at && <span className="nw-date">{fmtDate(c.at)}</span>}
        </div>
        <h3 className="nf-item-title"><a href={href}>{c.title}</a></h3>
        {c.text && <div className="nf-text is-clamped-2"><NewsText text={plainExcerpt(c.text, 240)} /></div>}
        <div className="nf-actions">
          {c.countdownAt && <Countdown at={c.countdownAt} label={c.countdownLabel} compact />}
          <a className="nw-more" href={href}>{t('nw.readShort')}<span aria-hidden> →</span></a>
        </div>
      </div>
    </article>
  );
}

/**
 * The feed: an editorial list, pinned items first and then the rest grouped by month.
 * `items` must already be ordered (pinned first, newest first) and filtered.
 */
export function PublicFeed({ items, servers, flat = false }: { items: PublicNews[]; servers?: Server[] | null; flat?: boolean }) {
  const { lang } = useI18n();
  if (items.length === 0) return null;
  const cards = items.map(cardOf);
  const pinned = cards.filter((c) => c.pinned);
  const normal = cards.filter((c) => !c.pinned);
  const groups = flat ? [{ key: 'all', label: '', items: normal }] : groupByMonth(normal.map((c) => ({ ...c, sentAt: c.at })), monthFormatter(lang));

  return (
    <div className="nw-feed ne-list">
      {pinned.length > 0 && (
        <section className="nw-group">
          <h3 className="ne-h">{t('nw.pinned')}</h3>
          {pinned.map((c) => <Entry key={c.id} c={c} servers={servers} lang={lang} />)}
        </section>
      )}
      {groups.map((g) => (
        <section key={g.key} className="nw-group">
          {(g.label || pinned.length > 0) && <h3 className="ne-h">{g.label || t('nw.earlier')}</h3>}
          {g.items.map((c) => <Entry key={c.id} c={c} servers={servers} lang={lang} />)}
        </section>
      ))}
    </div>
  );
}
