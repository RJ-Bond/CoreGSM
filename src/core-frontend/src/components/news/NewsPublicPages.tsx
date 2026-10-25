import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type NewsReaction, type PublicNews, type PublicNewsFull, type Server } from '../../api';
import { useAuth } from '../../auth';
import { t } from '../../i18n';
import { NewsArt } from '../Illustrations';
import type { OverviewData } from '../servers/overviewLogic';
import { IconNews, LoadError, PageHead, StateView, fmtDateTime, usePoll } from '../../ui';
import { NewsArticle } from './NewsArticle';
import { CategoryIcon, PinIcon } from './NewsIcons';
import { Countdown, categoryLabel, useNewsServers } from './NewsParts';
import { cardOf, hasGeneratedCover, NewsCover, PublicFeed } from './PublicFeed';
import { markSeen, readSeen } from './newsSeen';
import { CATEGORY_HEX, isRubricFilter, orderFeed, pickHero, plainExcerpt, visibleRubrics, type RubricFilter } from './newsLogic';

const STORE = 'news_rubric';
const SORT_STORE = 'news_sort';
const VIEW_STORE = 'news_view';
type FeedSort = 'new' | 'top' | 'discussed' | 'viewed';
const SORTS: FeedSort[] = ['new', 'top', 'discussed', 'viewed'];
const loadSort = (): FeedSort => {
  try {
    const v = localStorage.getItem(SORT_STORE);
    return SORTS.includes(v as FeedSort) ? (v as FeedSort) : 'new';
  } catch {
    return 'new';
  }
};
const loadDense = (): boolean => {
  try { return localStorage.getItem(VIEW_STORE) === 'dense'; } catch { return false; }
};
/** ?author=<id> of the address: the feed of one author */
const authorFromUrl = (): number | null => {
  const n = Number(new URLSearchParams(window.location.search).get('author'));
  return Number.isInteger(n) && n > 0 ? n : null;
};
/** how many news a page of the feed shows */
const PAGE = 20;
const ZERO_COUNTS: Record<RubricFilter, number> = { all: 0, announcement: 0, wipe: 0, update: 0, event: 0, maintenance: 0, other: 0 };
const loadRubric = (): RubricFilter => {
  try {
    const v = localStorage.getItem(STORE);
    return isRubricFilter(v) ? v : 'all';
  } catch {
    return 'all';
  }
};

function useMedia(q: string): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return undefined;
    const h = () => setOn(m.matches);
    h();
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [q]);
  return on;
}

type Works = NonNullable<OverviewData['maintenance']>;

/** upcoming and running maintenance windows (public overview); empty when the endpoint is unavailable */
function useWorks(): Works {
  const [works, setWorks] = useState<Works>([]);
  usePoll(
    () => api<OverviewData>('/overview?hours=24').then((o) => setWorks(Array.isArray(o?.maintenance) ? o.maintenance : [])).catch(() => undefined),
    60_000,
  );
  return works;
}

function AsideSection({ id, title, wide, children, className = '', hint }: { id: string; title: string; wide: boolean; children: ReactNode; className?: string; hint?: string }) {
  const [open, setOpen] = useState(false);
  const shown = wide || open;
  return (
    <section className={`nw-side-sec ${className}`}>
      {wide ? (
        <h2 className="nw-side-h">{title}</h2>
      ) : (
        <button type="button" className="nw-side-toggle" aria-expanded={open} aria-controls={`nw-side-${id}`} onClick={() => setOpen((v) => !v)}>
          <span>{title}</span>
          {hint && !open && <span className="nw-side-hint">{hint}</span>}
          <span aria-hidden>{open ? '−' : '+'}</span>
        </button>
      )}
      {shown && <div id={`nw-side-${id}`} className="nw-side-body">{children}</div>}
    </section>
  );
}

function FeedSkeleton() {
  return (
    <div className="nw-skel" aria-busy="true" aria-label={t('nw.loading')}>
      {[0, 1].map((i) => (
        <div key={i} className="nw-skel-entry">
          <div className="skeleton nw-skel-banner" />
          <div className="nw-skel-lines">
            <div className="skeleton h-4 w-full rounded-full" />
            <div className="skeleton h-4 w-11/12 rounded-full" />
            <div className="skeleton h-4 w-3/5 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** /news: rubrics, pinned first, month groups, the side panel */
export function NewsListPage() {
  const { me } = useAuth();
  const canWrite = me?.role === 'admin' || !!me?.perms?.includes('news');
  const [items, setItems] = useState<PublicNews[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [rubric, setRubricState] = useState<RubricFilter>(loadRubric);
  const [sort, setSortState] = useState<FeedSort>(loadSort);
  const [dense, setDenseState] = useState(loadDense);
  const [author, setAuthor] = useState<number | null>(authorFromUrl);
  // the feed comes in pages: one more than shown tells whether there is a next page
  const [limit, setLimit] = useState(PAGE);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [counts, setCounts] = useState<Record<RubricFilter, number>>(ZERO_COUNTS);
  const wide = useMedia('(min-width: 1100px)');
  // the time of the previous visit, taken once: the «Новое» marks stay while the page is open
  const [seen] = useState(readSeen);
  useEffect(() => { markSeen(); }, []);
  const servers = useNewsServers();
  const works = useWorks();
  const [hot, setHot] = useState<{ id: number; title: string; comments: number }[]>([]);
  useEffect(() => { api<typeof hot>('/news/discussed').then((l) => setHot(Array.isArray(l) ? l : [])).catch(() => undefined); }, []);

  const filter: RubricFilter = rubric;
  const load = () => Promise.all([
    api<PublicNews[]>(`/news?limit=${limit + 1}${filter === 'all' ? '' : `&category=${filter}`}${sort === 'new' ? '' : `&sort=${sort}`}${author ? `&author=${author}` : ''}`),
    api<Record<RubricFilter, number>>('/news/counts').catch(() => null),
  ])
    .then(([n, c]) => {
      const list = Array.isArray(n) ? n : [];
      setItems(list.slice(0, limit));
      setHasMore(list.length > limit);
      if (c) setCounts({ ...ZERO_COUNTS, ...c });
      setError('');
    })
    .catch((e: Error) => setError(e.message))
    .finally(() => { setLoaded(true); setLoadingMore(false); });
  usePoll(load, 30_000);
  // another rubric or a bigger page: load at once (the poll above only repeats it)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, filter, sort, author]);

  const setRubric = (r: RubricFilter) => {
    setRubricState(r);
    setLimit(PAGE);
    try { localStorage.setItem(STORE, r); } catch { /* not remembered */ }
  };
  const setSort = (s: FeedSort) => {
    setSortState(s);
    setLimit(PAGE);
    try { localStorage.setItem(SORT_STORE, s); } catch { /* not remembered */ }
  };
  const setDense = (v: boolean) => {
    setDenseState(v);
    try { localStorage.setItem(VIEW_STORE, v ? 'dense' : 'cards'); } catch { /* not remembered */ }
  };
  const clearAuthor = () => {
    setAuthor(null);
    setLimit(PAGE);
    window.history.replaceState(null, '', window.location.pathname);
  };
  const showMore = () => { setLoadingMore(true); setLimit((l) => l + PAGE); };

  // sorted by something else than the date: the order comes from the server as it is
  const ordered = useMemo(() => (sort === 'new' ? orderFeed(items) : items), [items, sort]);
  // the big block on top: only on the first page of «Все», the rest of the feed goes below it
  const hero = filter === 'all' && sort === 'new' && !dense && !author ? pickHero(ordered) : null;
  const shown = hero ? ordered.filter((n) => n.id !== hero.id) : ordered;
  const heroCard = hero ? cardOf(hero) : null;

  // the next page loads by itself when the end of the feed comes into view (the button stays as a fallback)
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el || !hasMore || loadingMore || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) { setLoadingMore(true); setLimit((l) => l + PAGE); } }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, items.length]);
  const pinned = ordered.filter((n) => (n.pinned ?? n.payload?.pinned)).slice(0, 5);
  const now = Date.now();
  // the nearest event with a timer among the loaded news
  const soon = ordered
    .map((n) => ({ n, at: n.payload?.countdownAt }))
    .filter((x): x is { n: PublicNews; at: number } => typeof x.at === 'number' && x.at > now)
    .sort((a, b) => a.at - b.at)[0];
  const upcoming = works.filter((w) => w.endTs > now).sort((a, b) => a.startTs - b.startTs).slice(0, 3);

  const rubrics = visibleRubrics(counts, filter);
  const liveServers = (servers ?? []).slice(0, 6);

  const chip = (id: RubricFilter) => (
    <button key={id} type="button" className="nw-rub" aria-pressed={filter === id} onClick={() => setRubric(id)}>
      {id !== 'all' && <CategoryIcon category={id} size={15} />}
      {categoryLabel(id)}
      <span className="nw-rub-n tabular-nums">{counts[id]}</span>
    </button>
  );

  const hasSide = pinned.length > 0 || hot.length > 0 || upcoming.length > 0 || liveServers.length > 0 || !!soon;

  return (
    <div className="nw-page">
      <div className="nw-glow" aria-hidden />
      <div className={`nw-grid ${hasSide ? 'has-side' : ''}`}>
        <div className="nw-main">
          <PageHead icon={<IconNews />} title={t('nav.news')} subtitle={t('nw.subtitle')} />
          {counts.all > 0 && rubrics.length > 0 && (
            <div className="nw-rubrics" role="group" aria-label={t('nw.rubrics')}>
              {chip('all')}
              {rubrics.map((r) => chip(r))}
            </div>
          )}
          {loaded && counts.all > 1 && (
            <div className="nw-tools">
              <div className="seg" role="group" aria-label={t('nw.sort')}>
                {SORTS.map((s) => <button key={s} type="button" className="seg-item" aria-current={sort === s ? 'true' : undefined} onClick={() => setSort(s)}>{t(`nw.sort.${s}` as const)}</button>)}
              </div>
              <div className="seg" role="group" aria-label={t('nw.view')}>
                <button type="button" className="seg-item" aria-current={!dense ? 'true' : undefined} onClick={() => setDense(false)}>{t('nw.view.cards')}</button>
                <button type="button" className="seg-item" aria-current={dense ? 'true' : undefined} onClick={() => setDense(true)}>{t('nw.view.dense')}</button>
              </div>
              {author && <button type="button" className="nw-rub" onClick={clearAuthor}>{t('nw.author.filter')} <span aria-hidden>✕</span></button>}
            </div>
          )}
          {error && items.length === 0 ? <LoadError error={error} onRetry={() => void load()} /> : null}
          {!loaded && <FeedSkeleton />}
          {loaded && !error && ordered.length === 0 && (
            <>
            <StateView
              kind="empty"
              art={<NewsArt />}
              title={t('nw.empty.title')}
              text={t('nw.empty.text')}
              action={canWrite ? <a href="/admin/news/new" className="btn">{t('nw.empty.write')}</a> : <a href="/servers" className="btn btn-soft">{t('nw.empty.servers')}</a>}
            />
            <ul className="nw-hints" aria-label={t('nw.hints.title')}>
              {(['update', 'event', 'maintenance'] as const).map((c) => (
                <li key={c} className={`nw-hint nw-tone-${c}`}>
                  <span className="nw-hint-ico"><CategoryIcon category={c} size={20} /></span>
                  <b>{t(`nw.hints.${c}` as const)}</b>
                  <span>{t(`nw.hints.${c}.t` as const)}</span>
                </li>
              ))}
            </ul>
            </>
          )}
          {loaded && ordered.length > 0 && shown.length === 0 && !hero && (
            <StateView
              kind="empty"
              art={<NewsArt />}
              title={t('nw.emptyRubric.title')}
              text={t('nw.emptyRubric.text')}
              action={<button type="button" className="btn btn-soft" onClick={() => setRubric('all')}>{t('nw.showAll')}</button>}
            />
          )}
          {heroCard && (
            <article className="nw-hero fade-in">
              <NewsCover c={heroCard} servers={servers} href={`/news/${heroCard.id}`} tall />
              <div className="nw-hero-in">
                {heroCard.text && <p>{plainExcerpt(heroCard.text, 260)}</p>}
                <a className="btn" href={`/news/${heroCard.id}`}>{t('nw.readShort')}<span aria-hidden> →</span></a>
              </div>
            </article>
          )}
          {shown.length > 0 && <div className="fade-in"><PublicFeed items={shown} servers={servers} seen={seen} dense={dense} plain={sort !== 'new'} /></div>}
          {hasMore && (
            <div className="ne-more" ref={more}>
              <button type="button" className="btn btn-soft" disabled={loadingMore} aria-busy={loadingMore || undefined} onClick={showMore}>
                {loadingMore ? t('nw.loadingMore') : t('nw.more')}
              </button>
            </div>
          )}
        </div>

        {hasSide && (
          <aside className="nw-aside" aria-label={t('nw.side')}>
            {pinned.length > 0 && (
              <AsideSection id="pinned" title={t('nw.pinnedList')} wide={wide}>
                <ul className="nw-side-list">
                  {pinned.map((n) => (
                    <li key={n.id}>
                      <a href={`/news/${n.id}`}><PinIcon size={14} /><span>{n.payload?.embed?.title || n.title || t('nw.untitled')}</span></a>
                    </li>
                  ))}
                </ul>
              </AsideSection>
            )}
            {hot.length > 0 && (
              <AsideSection id="hot" title={t('nw.cm.discussed')} wide={wide}>
                <ul className="nw-side-list">
                  {hot.map((n) => (
                    <li key={n.id}>
                      <a href={`/news/${n.id}#comments`}><span>{n.title}</span><span className="nw-live-n tabular-nums">💬 {n.comments}</span></a>
                    </li>
                  ))}
                </ul>
              </AsideSection>
            )}
            {liveServers.length > 0 && (
              <AsideSection id="live" title={t('nw.liveNow')} wide={wide} hint={t('nw.liveHint', { n: liveServers.reduce((a, sv) => a + (sv.online ? sv.players : 0), 0), s: liveServers.filter((sv) => sv.online).length })}>
                <ul className="nw-side-list nw-live">
                  {liveServers.map((sv: Server) => (
                    <li key={sv.id}>
                      <a href={`/servers/${sv.id}`}>
                        <span className={`nw-live-dot ${sv.online ? 'is-on' : 'is-off'}`} aria-hidden />
                        <span className="nw-live-name">{sv.name}</span>
                        <span className="nw-live-n tabular-nums">{sv.online ? `${sv.players}/${sv.maxPlayers}` : t('nw.offline')}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </AsideSection>
            )}
            {soon && (
              <AsideSection id="soon" title={t('nw.soon')} wide={wide}>
                <a className="nw-soon" href={`/news/${soon.n.id}`}>
                  <b>{soon.n.payload?.embed?.title || soon.n.title}</b>
                  <Countdown at={soon.at} label={soon.n.payload?.countdownLabel} compact />
                </a>
              </AsideSection>
            )}
            {upcoming.length > 0 && (
              <AsideSection id="works" title={t('nw.works')} wide={wide}>
                <ul className="nw-side-list nw-works">
                  {upcoming.map((w) => (
                    <li key={w.id}>
                      <span className="nw-work-name">{w.name}</span>
                      <span className="nw-work-meta">
                        {w.active || w.startTs <= now ? t('nw.works.now') : fmtDateTime(w.startTs)}
                        {w.serverName ? ` · ${w.serverName}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </AsideSection>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/** /news/<id> */
export function NewsArticlePage({ id }: { id: number }) {
  const { me } = useAuth();
  const [item, setItem] = useState<PublicNewsFull | null>(null);
  const [error, setError] = useState<{ status: number; text: string } | null>(null);
  const servers = useNewsServers(30_000, true);

  useEffect(() => { setItem(null); setError(null); }, [id]);
  const card = item ? cardOf(item) : null;
  // «Читайте также» comes in the answer for the item (the same rubric first)
  const related = item?.related ?? [];

  const load = () => api<PublicNewsFull>(`/news/${id}`)
    .then((n) => { setItem((cur) => (cur && cur.id === n.id && cur.reactions && n.reactions === undefined ? { ...n, reactions: cur.reactions } : n)); setError(null); })
    .catch((e: unknown) => setError({ status: e instanceof ApiError ? e.status : 0, text: (e as Error).message }));
  usePoll(load, 30_000);

  const back = <a className="btn btn-soft" href="/news">{t('nw.back')}</a>;
  return (
    <div className="nw-page">
      {card && (
        card.image
          ? <div className="nw-backdrop" aria-hidden style={{ backgroundImage: `url("${card.image}")` }} />
          : <div className={`nw-backdrop ${hasGeneratedCover(card, servers) ? 'is-flat' : ''}`} aria-hidden style={{ ['--gen' as string]: CATEGORY_HEX[card.category] }} />
      )}
      <div className="nw-article-wrap">
        {error && !item && (error.status === 404
          ? <StateView kind="notfound" title={t('nw.notfound.title')} text={t('nw.notfound.text')}>{back}</StateView>
          : <LoadError error={error.text} onRetry={() => void load()} />)}
        {!item && !error && (
          <div className="nw-skel" aria-busy="true" aria-label={t('nw.loading')}>
            <div className="skeleton nw-skel-hero is-tall" />
            <div className="skeleton h-5 w-2/3 rounded-full" />
            <div className="skeleton h-5 w-full rounded-full" />
            <div className="skeleton h-5 w-5/6 rounded-full" />
          </div>
        )}
        {item && (
          <div className="fade-in">
            <NewsArticle
              item={item}
              servers={servers}
              canReact={!!me}
              related={related}
              onReactions={(r: NewsReaction[]) => setItem((cur) => (cur ? { ...cur, reactions: r } : cur))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
