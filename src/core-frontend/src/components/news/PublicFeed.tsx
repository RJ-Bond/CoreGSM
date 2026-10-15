import type { CSSProperties } from 'react';
import type { NewsAction, NewsCategory, NewsChange, NewsReaction, PublicNews, Server } from '../../api';
import { useI18n, t } from '../../i18n';
import { fmtDate } from '../../ui';
import { AuthorLine, CategoryChip, Countdown, NewsText, PinChip } from './NewsParts';
import {
  categoryOf, defaultCoverBackground, galleryUrls, groupByMonth, isPinned, newsImage, plainExcerpt,
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

/** big cover with the title over a bottom gradient; used by the feed hero and by the news page */
export function NewsCover({ c, servers, as: H = 'h2', href, tall = false }: { c: Card; servers: Server[] | null | undefined; as?: 'h1' | 'h2'; href?: string; tall?: boolean }) {
  return (
    <div className={`nw-cover ${tall ? 'is-tall' : ''}`} style={{ ['--nf-accent' as string]: c.accent }}>
      <div className="nw-cover-bg" style={coverStyle(c, servers)} aria-hidden />
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

function Thumbs({ c, href }: { c: Card; href: string }) {
  if (c.gallery.length === 0) return null;
  const shown = c.gallery.slice(0, 4);
  const more = c.gallery.length - shown.length;
  return (
    <a className="nw-strip" href={href} aria-label={t('nw.gallery')}>
      {shown.map((u, i) => <img key={u + i} src={u} alt="" loading="lazy" decoding="async" />)}
      {more > 0 && <span className="nw-strip-more">+{more}</span>}
    </a>
  );
}

function Hero({ c, servers }: { c: Card; servers: Server[] | null | undefined }) {
  const href = `/news/${c.id}`;
  return (
    <article className="nf-hero nw-hero" style={{ ['--nf-accent' as string]: c.accent }}>
      <NewsCover c={c} servers={servers} href={href} />
      <div className="nf-hero-in">
        {(c.author || c.countdownAt) && (
          <div className="nf-meta">
            {c.author && <AuthorLine name={c.author.name} icon={c.author.icon} role={c.role} />}
            {c.countdownAt && <Countdown at={c.countdownAt} label={c.countdownLabel} />}
          </div>
        )}
        {(c.text || c.fields.length > 0) && <div className="nf-text is-clamped"><NewsText text={c.text} fields={c.fields} /></div>}
        <Thumbs c={c} href={href} />
        <div className="nf-actions">
          <a className="btn" href={href}>{t('nw.read')}</a>
          {c.link && <a className="btn btn-soft" href={c.link} target="_blank" rel="noopener noreferrer">{t('nw.openLink')}</a>}
        </div>
      </div>
    </article>
  );
}

function Row({ c, servers }: { c: Card; servers: Server[] | null | undefined }) {
  const href = `/news/${c.id}`;
  return (
    <article className="nf-item nw-item" style={{ ['--nf-accent' as string]: c.accent }}>
      <a className="nf-thumb nw-thumb" href={href} style={coverStyle(c, servers, true)} aria-label={c.title} tabIndex={-1} />
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
 * The feed column: the first item large, then pinned ones, then the rest grouped by month.
 * `items` must already be ordered (pinned first, newest first) and filtered.
 */
export function PublicFeed({ items, servers, flat = false }: { items: PublicNews[]; servers?: Server[] | null; flat?: boolean }) {
  const { lang } = useI18n();
  if (items.length === 0) return null;
  const cards = items.map(cardOf);
  const [hero, ...rest] = cards;
  const pinned = rest.filter((c) => c.pinned);
  const normal = rest.filter((c) => !c.pinned);
  const groups = flat ? [{ key: 'all', label: '', items: normal }] : groupByMonth(normal.map((c) => ({ ...c, sentAt: c.at })), monthFormatter(lang));

  return (
    <div className="nf nw-feed">
      <Hero c={hero!} servers={servers} />
      {pinned.length > 0 && (
        <section className="nw-group">
          <h3 className="nf-more">{t('nw.pinned')}</h3>
          <div className="nf-list">{pinned.map((c) => <Row key={c.id} c={c} servers={servers} />)}</div>
        </section>
      )}
      {groups.map((g) => (
        <section key={g.key} className="nw-group">
          <h3 className="nf-more">{g.label || t('nw.earlier')}</h3>
          <div className="nf-list">{g.items.map((c) => <Row key={c.id} c={c} servers={servers} />)}</div>
        </section>
      ))}
    </div>
  );
}
