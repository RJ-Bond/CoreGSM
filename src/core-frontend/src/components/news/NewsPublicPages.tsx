import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, type NewsReaction, type PublicNews, type PublicNewsFull } from '../../api';
import { useAuth } from '../../auth';
import { t } from '../../i18n';
import { NewsArt } from '../Illustrations';
import type { OverviewData } from '../servers/overviewLogic';
import { IconNews, LoadError, PageHead, StateView, fmtDateTime, usePoll } from '../../ui';
import { NewsArticle } from './NewsArticle';
import { CategoryIcon, PinIcon } from './NewsIcons';
import { categoryLabel, useNewsServers } from './NewsParts';
import { PublicFeed } from './PublicFeed';
import { RUBRICS, countByCategory, filterByCategory, isRubricFilter, orderFeed, type RubricFilter } from './newsLogic';

const STORE = 'news_rubric';
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

function AsideSection({ id, title, wide, children, className = '' }: { id: string; title: string; wide: boolean; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const shown = wide || open;
  return (
    <section className={`nw-side-sec ${className}`}>
      {wide ? (
        <h2 className="nw-side-h">{title}</h2>
      ) : (
        <button type="button" className="nw-side-toggle" aria-expanded={open} aria-controls={`nw-side-${id}`} onClick={() => setOpen((v) => !v)}>
          <span>{title}</span>
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
      <div className="skeleton nw-skel-hero" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="nw-skel-row">
          <div className="skeleton nw-skel-thumb" />
          <div className="nw-skel-lines">
            <div className="skeleton h-3 w-24 rounded-full" />
            <div className="skeleton h-5 w-4/5 rounded-full" />
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
  const wide = useMedia('(min-width: 1100px)');
  const servers = useNewsServers();
  const works = useWorks();

  const load = () => api<PublicNews[]>('/news')
    .then((n) => { setItems(Array.isArray(n) ? n : []); setError(''); })
    .catch((e: Error) => setError(e.message))
    .finally(() => setLoaded(true));
  usePoll(load, 30_000);

  const setRubric = (r: RubricFilter) => {
    setRubricState(r);
    try { localStorage.setItem(STORE, r); } catch { /* not remembered */ }
  };

  const ordered = useMemo(() => orderFeed(items), [items]);
  const counts = useMemo(() => countByCategory(ordered), [ordered]);
  const filter: RubricFilter = rubric;
  const shown = useMemo(() => filterByCategory(ordered, filter), [ordered, filter]);
  const pinned = ordered.filter((n) => (n.pinned ?? n.payload?.pinned)).slice(0, 5);
  const now = Date.now();
  const upcoming = works.filter((w) => w.endTs > now).sort((a, b) => a.startTs - b.startTs).slice(0, 3);

  const chip = (id: RubricFilter) => (
    <button key={id} type="button" className="nw-rub" aria-pressed={filter === id} onClick={() => setRubric(id)}>
      {id !== 'all' && <CategoryIcon category={id} size={15} />}
      {categoryLabel(id)}
      <span className="nw-rub-n tabular-nums">{counts[id]}</span>
    </button>
  );

  const hasSide = pinned.length > 0 || upcoming.length > 0 || ordered.length > 0;

  return (
    <div className="nw-page">
      <div className={`nw-grid ${hasSide ? 'has-side' : ''}`}>
        <div className="nw-main">
          <PageHead icon={<IconNews />} title={t('nav.news')} subtitle={t('nw.subtitle')} />
          {ordered.length > 0 && (
            <div className="nw-rubrics" role="group" aria-label={t('nw.rubrics')}>
              {chip('all')}
              {RUBRICS.map((r) => chip(r))}
            </div>
          )}
          {error && items.length === 0 ? <LoadError error={error} onRetry={() => void load()} /> : null}
          {!loaded && <FeedSkeleton />}
          {loaded && !error && ordered.length === 0 && (
            <StateView
              kind="empty"
              art={<NewsArt />}
              title={t('nw.empty.title')}
              text={t('nw.empty.text')}
              action={canWrite ? <a href="/admin/news/new" className="btn">{t('nw.empty.write')}</a> : <a href="/servers" className="btn btn-soft">{t('nw.empty.servers')}</a>}
            />
          )}
          {loaded && ordered.length > 0 && shown.length === 0 && (
            <StateView
              kind="empty"
              art={<NewsArt />}
              title={t('nw.emptyRubric.title')}
              text={t('nw.emptyRubric.text')}
              action={<button type="button" className="btn btn-soft" onClick={() => setRubric('all')}>{t('nw.showAll')}</button>}
            />
          )}
          {shown.length > 0 && <div className="fade-in"><PublicFeed items={shown} servers={servers} /></div>}
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
            <AsideSection id="rubrics" title={t('nw.rubrics')} wide={wide}>
              <ul className="nw-side-list">
                {RUBRICS.map((r) => (
                  <li key={r}>
                    <button type="button" className="nw-side-rub" aria-pressed={filter === r} onClick={() => setRubric(filter === r ? 'all' : r)}>
                      <CategoryIcon category={r} size={15} />
                      <span>{categoryLabel(r)}</span>
                      <span className="nw-rub-n tabular-nums">{counts[r]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </AsideSection>
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

  const load = () => api<PublicNewsFull>(`/news/${id}`)
    .then((n) => { setItem((cur) => (cur && cur.id === n.id && cur.reactions && n.reactions === undefined ? { ...n, reactions: cur.reactions } : n)); setError(null); })
    .catch((e: unknown) => setError({ status: e instanceof ApiError ? e.status : 0, text: (e as Error).message }));
  usePoll(load, 30_000);

  const back = <a className="btn btn-soft" href="/news">{t('nw.back')}</a>;
  return (
    <div className="nw-page">
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
              onReactions={(r: NewsReaction[]) => setItem((cur) => (cur ? { ...cur, reactions: r } : cur))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
