import type { CSSProperties } from 'react';
import type { NewsAction, NewsCategory, NewsChange, NewsReaction, PublicNews, Server } from '../../api';
import { useI18n, t } from '../../i18n';
import { fmtDate, fmtTime, toast } from '../../ui';
import { useAuth } from '../../auth';
import { AuthorLine, CategoryChip, Countdown, NewsText, PinChip } from './NewsParts';
import { CategoryIcon, IconCopyLink, IconEditPen } from './NewsIcons';
import {
  CATEGORY_HEX, categoryOf, defaultCoverBackground, galleryUrls, groupByMonth, isGeneratedCover, isPinned, newsImage, plainExcerpt, readingMinutes,
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

/** «сегодня, 14:30» / «вчера, 09:05» for the last two days, the date otherwise */
export function newsWhen(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return t('nw.today', { time: fmtTime(at) });
  if (diff === 1) return t('nw.yesterday', { time: fmtTime(at) });
  return fmtDate(at);
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
      <div className={`nw-cover-bg ${gen ? 'nw-gen' : ''}`} data-v={gen ? c.id % 4 : undefined} style={gen ? undefined : coverStyle(c, servers)} aria-hidden>
        {gen && <span className="nw-gen-ico"><CategoryIcon category={c.category} size={96} /></span>}
      </div>
      <div className="nw-cover-shade" aria-hidden />
      <div className="nw-cover-in">
        <div className="nw-cover-chips">
          {c.pinned && <PinChip />}
          <CategoryChip category={c.category} />
          {c.at && <span className="nw-chip nw-chip-date">{newsWhen(c.at)}</span>}
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

/**
 * One news as a small article: a banner (the picture, or a cover drawn by the panel) with the rubric, the date and the
 * headline on it, and the whole text below (a list stays a list), the author and a link.
 */
function Entry({ c, servers }: { c: Card; servers: Server[] | null | undefined; lang: 'ru' | 'en' }) {
  const href = `/news/${c.id}`;
  const gen = hasGeneratedCover(c, servers);
  const { me } = useAuth();
  const canEdit = me?.role === 'admin' || !!me?.perms?.includes('news');
  const minutes = readingMinutes(c.text);
  const long = c.text.length > 700 || c.text.split('\n').length > 9;
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/n/${c.id}`); toast(t('nw.copied')); } catch { toast(t('nw.copyFail'), 'err'); }
  };
  return (
    <article className={`nb ${c.pinned ? 'is-pinned' : ''}`} style={{ ['--nf-accent' as string]: c.accent }}>
      <a className={`nb-banner ${gen ? 'nw-gen' : ''}`} data-v={gen ? c.id % 4 : undefined} href={href} style={gen ? genVars(c) : coverStyle(c, servers)} aria-label={c.title}>
        {gen && <span className="nw-gen-ico"><CategoryIcon category={c.category} size={96} /></span>}
        <span className="nb-banner-in">
          <span className="nb-chips">
            {c.pinned && <PinChip />}
            <CategoryChip category={c.category} />
            {c.at && <time className="nb-date" dateTime={new Date(c.at).toISOString()} title={fmtDate(c.at)}>{newsWhen(c.at)}</time>}
          </span>
          <h3 className="nb-title">{c.title}</h3>
        </span>
      </a>
      <div className="nb-body">
        {(c.text || c.fields.length > 0) && <div className={`nb-text ${long ? 'is-long' : ''}`}><NewsText text={c.text} fields={c.fields} /></div>}
        {c.countdownAt && <Countdown at={c.countdownAt} label={c.countdownLabel} compact />}
        <div className="nb-foot">
          {c.author && <AuthorLine name={c.author.name} icon={c.author.icon} role={c.role} />}
          <span className="nb-tools">
            {minutes > 0 && <span className="nw-read">{t('nw.readTime', { n: minutes })}</span>}
            <button type="button" className="nb-tool" onClick={() => void copy()} title={t('nw.copyLink')} aria-label={t('nw.copyLink')}><IconCopyLink /></button>
            {canEdit && <a className="nb-tool" href={`/admin/news/${c.id}`} title={t('nw.edit')} aria-label={t('nw.edit')}><IconEditPen /></a>}
            <a className="nw-more" href={href}>{t('nw.readShort')}<span aria-hidden> →</span></a>
          </span>
        </div>
      </div>
    </article>
  );
}

export function Row({ c, servers }: { c: Card; servers: Server[] | null | undefined }) {
  const href = `/news/${c.id}`;
  const gen = hasGeneratedCover(c, servers);
  return (
    <article className="nf-item nw-item" style={{ ['--nf-accent' as string]: c.accent }}>
      <a className={`nf-thumb nw-thumb ${gen ? 'nw-gen' : ''}`} data-v={gen ? c.id % 4 : undefined} href={href} style={gen ? genVars(c) : coverStyle(c, servers, true)} aria-label={c.title} tabIndex={-1}>
        {gen && <span className="nw-gen-ico"><CategoryIcon category={c.category} size={64} /></span>}
      </a>
      <div className="nf-item-in">
        <div className="nw-chips">
          {c.pinned && <PinChip />}
          <CategoryChip category={c.category} />
          {c.at && <span className="nw-date">{newsWhen(c.at)}</span>}
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
          <h2 className="ne-h">{t('nw.pinned')}</h2>
          {pinned.map((c) => <Entry key={c.id} c={c} servers={servers} lang={lang} />)}
        </section>
      )}
      {groups.map((g) => (
        <section key={g.key} className="nw-group">
          {(g.label || pinned.length > 0) && <h2 className="ne-h">{g.label || t('nw.earlier')}</h2>}
          {g.items.map((c) => <Entry key={c.id} c={c} servers={servers} lang={lang} />)}
        </section>
      ))}
    </div>
  );
}
