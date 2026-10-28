import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PlayerNow } from '../../api';
import { StateView } from '../StateView';
import NickPic from '../NickPic';
import { t, useI18n } from '../../i18n';
import { fmtDateTime, plural, toast } from '../../ui';
import { useKnownNicks } from './useKnownNicks';
import { sortPlayers, type PlayerSort } from './serverLogic';
import { rankById } from '../../vrisingRanks';
import { RankEmblem, rankName } from '../profile/VrRank';
import { NEWBIE_MS, VETERAN_MS, nickHue, nickInitial, playedFor, useNow, useStickyTop } from './helpers';

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <NickPic name={name} size={size} className="rounded-ui-md">
      <span
        className="avatar-hue grid shrink-0 place-items-center rounded-ui-md font-extrabold"
        style={{ ['--h' as string]: nickHue(name), width: size, height: size, fontSize: size * 0.42 }}
        aria-hidden
      >
        {nickInitial(name)}
      </span>
    </NickPic>
  );
}

const VIEW_KEY = 'coregsm_pl_view';
const readView = (): 'list' | 'tiles' => {
  try { return localStorage.getItem(VIEW_KEY) === 'tiles' ? 'tiles' : 'list'; } catch { return 'list'; }
};

const copyNick = (name: string) => void navigator.clipboard?.writeText(name).then(() => toast(t('srv.pl.copied')), () => toast(name, 'info', 6000));

/** a press held for half a second copies the nick; the click that follows the release is swallowed */
function useLongPress(name: string) {
  const timer = useRef(0);
  const fired = useRef(false);
  const cancel = () => window.clearTimeout(timer.current);
  useEffect(() => cancel, []);
  return {
    onPointerDown: (e: { pointerType: string }) => {
      fired.current = false;
      if (e.pointerType === 'mouse') return;
      cancel();
      timer.current = window.setTimeout(() => { fired.current = true; if (navigator.vibrate) navigator.vibrate(15); copyNick(name); }, 520);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: { preventDefault: () => void }) => { if (fired.current) e.preventDefault(); },
    /** true when this click is the tail of a long press */
    swallow: () => { const f = fired.current; fired.current = false; return f; },
  };
}

function NickButton({ name, className, style, onClick, expanded, children }: { name: string; className: string; style?: CSSProperties; onClick: () => void; expanded?: boolean; children: ReactNode }) {
  const lp = useLongPress(name);
  const { swallow, ...handlers } = lp;
  return (
    <button type="button" className={className} style={style} aria-expanded={expanded} {...handlers} onClick={() => { if (!swallow()) onClick(); }}>
      {children}
    </button>
  );
}

interface Row { key: string; name: string; since: number | null; rankId?: string }

const clock = (ts: number) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const joinedAt = (ts: number, now: number) => {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return now - ts < 20 * 3600_000 && d.getDate() === new Date(now).getDate() ? time : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${time}`;
};

/**
 * Players on the server. `limit`: overview mode (first N, no search, link to the full list via `moreHref`).
 * `fresh`: names that appeared since the previous poll (a short highlight).
 * Full mode: a count header, search, sort, and every row expands into a small card.
 */
export default function PlayersList({
  online, players, names, list, fresh, limit, moreHref, onSubscribe,
}: { online: boolean; players: number; names: string[]; list: PlayerNow[]; fresh: Set<string>; limit?: number; moreHref?: string; onSubscribe?: () => void }) {
  const now = useNow(30_000);
  useI18n();
  const stickyTop = useStickyTop();
  const [sort, setSort] = useState<PlayerSort>('longest');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'tiles'>(readView);
  const setViewSaved = (v: 'list' | 'tiles') => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };
  const known = useKnownNicks();

  const total = list.length || names.length;
  const hiddenCount = Math.max(0, players - total);
  const baseRows = useMemo(() => {
    let r: Row[] = list.map((p, i) => ({ key: `${p.name}-${p.since}-${i}`, name: p.name || 'Без имени', since: p.since as number | null, rankId: p.rankId }));
    if (!r.length) r = names.map((n, i) => ({ key: `${n}-${i}`, name: n || 'Без имени', since: null }));
    return r;
  }, [list, names]);
  const rows = useMemo(() => {
    let r = baseRows;
    const q = query.trim().toLowerCase();
    if (q) r = r.filter((p) => p.name.toLowerCase().includes(q));
    r = sortPlayers(r, r.every((p) => p.since == null) ? 'alpha' : sort);
    return r;
  }, [baseRows, query, sort]);

  // players who have just left stay on the list for a moment and fade out (the full list only)
  const prevRows = useRef<Row[] | null>(null);
  const [gone, setGone] = useState<Row[]>([]);
  useEffect(() => {
    const prev = prevRows.current;
    prevRows.current = baseRows;
    if (limit || !prev || !online) return;
    const now = new Set(baseRows.map((r) => r.name));
    const left = prev.filter((r) => !now.has(r.name));
    if (!left.length) return;
    setGone((g) => [...g, ...left].slice(-6));
    window.setTimeout(() => setGone((g) => g.filter((x) => !left.includes(x))), 2600);
  }, [baseRows, limit, online]);
  const maxDur = useMemo(() => Math.max(1, ...baseRows.map((r) => (r.since != null ? now - r.since : 0))), [baseRows, now]);
  const [pages, setPages] = useState(1);
  const PAGE = 30;
  const shown = limit ? rows.slice(0, limit) : rows.slice(0, PAGE * pages);
  const FRESH_MS = 15 * 60_000;
  // the groups «for a long time» / «just joined» only when both exist and the order is by time
  const grouped = !limit && !query.trim() && sort === 'longest' && rows.length >= 4 && rows.some((p) => p.since != null && now - p.since < FRESH_MS) && rows.some((p) => p.since != null && now - p.since >= FRESH_MS);
  const showSearch = !limit && total > 5;
  const hasTimes = list.length > 0;

  if (!online) {
    return <StateView kind="offline" bare compact title={t('srv.pl.offline')} text={t('srv.pl.offlineText')} />;
  }
  if (total === 0 && players === 0) {
    return (
      <div className="pl-empty">
        <svg width="132" height="96" viewBox="0 0 132 96" fill="none" aria-hidden>
          <circle cx="66" cy="54" r="34" fill="currentColor" opacity=".08" />
          <path d="M84 40a24 24 0 1 1-26-26 18 18 0 0 0 26 26z" fill="currentColor" opacity=".35" />
          <circle cx="30" cy="22" r="2.500" fill="currentColor" opacity=".5" />
          <circle cx="104" cy="30" r="2" fill="currentColor" opacity=".4" />
          <circle cx="98" cy="72" r="3" fill="currentColor" opacity=".3" />
          <circle cx="24" cy="66" r="2" fill="currentColor" opacity=".4" />
        </svg>
        <p className="pl-empty-t">{t('srv.pl.none')}</p>
        <p className="pl-empty-x">{t('srv.pl.noneText')}</p>
        {onSubscribe && !limit && <button type="button" className="btn btn-soft btn-sm" onClick={onSubscribe}>Подписаться на уведомления</button>}
      </div>
    );
  }
  if (total === 0) {
    return (
      <StateView
        kind="empty"
        bare
        compact
        title={players > 0 ? t('srv.pl.noNames', { n: players }) : t('srv.pl.none')}
        text={players > 0 ? t('srv.pl.noNamesText') : t('srv.pl.noneText')}
      />
    );
  }

  const sorts: [PlayerSort, string][] = [['longest', t('srv.pl.longest')], ['newest', t('srv.pl.newest')], ['alpha', t('srv.pl.alpha')]];
  return (
    <div>
      {!limit && (
        <div className="pl-sticky" style={{ top: stickyTop }}>
          <p className="pl-count" aria-live="polite">
            {query.trim()
              ? t('srv.pl.found', { n: rows.length, total })
              : <>
                  <b>{total}</b> {plural(total, ['игрок', 'игрока', 'игроков'])} {t('srv.pl.withNames')}{hiddenCount > 0 ? ` · ${t('srv.pl.hidden', { n: hiddenCount })}` : ''}
                </>}
          </p>
          {(showSearch || (hasTimes && total > 1)) && (
            <div className="flex flex-wrap items-center gap-2">
              {showSearch && (
                <input
                  type="search"
                  className="input h-10! min-w-0 flex-1 basis-40"
                  placeholder={t('srv.pl.search')}
                  aria-label={t('srv.pl.searchLabel')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                />
              )}
              {total > 1 && (
                <div className="seg pl-view" role="group" aria-label="Вид списка">
                  <button type="button" className="seg-item" aria-pressed={view === 'list'} onClick={() => setViewSaved('list')} title="Список" aria-label="Список">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>
                  </button>
                  <button type="button" className="seg-item" aria-pressed={view === 'tiles'} onClick={() => setViewSaved('tiles')} title="Плитки" aria-label="Плитки">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>
                  </button>
                </div>
              )}
              {total > 1 && (
                <div className="srv-chipset" role="group" aria-label={t('srv.pl.sort')}>
                  {sorts
                    .filter(([k]) => k === 'alpha' || hasTimes)
                    .map(([k, label]) => (
                      <button key={k} type="button" className={`chip-filter ${sort === k ? 'on' : ''}`} aria-pressed={sort === k} onClick={() => setSort(k)}>{label}</button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <StateView kind="empty" bare compact title={t('srv.pl.noMatch', { q: query })} text={t('srv.pl.noMatchText')} />
      ) : !limit && view === 'tiles' ? (
        <ul className="pl-tiles">
          {shown.map((p) => {
            const dur = p.since != null ? now - p.since : null;
            const tileRank = rankById(p.rankId);
            return (
              <li key={p.key} className={`min-w-0 ${fresh.has(p.name) ? 'player-new' : ''}`}>
                <NickButton name={p.name} className="pl-tile" onClick={() => copyNick(p.name)}>
                  <span className="pl-avb">
                    <Avatar name={p.name} size={44} />
                    {tileRank && <i className="pl-badge" title={rankName(tileRank)}><RankEmblem rank={tileRank} size={20} /></i>}
                  </span>
                  <b className="pl-tile-n" title={p.name}>{p.name}</b>
                  <span className="pl-tile-t">{p.since != null ? playedFor(p.since, now) : 'в сети'}</span>
                  {dur != null && <i className="pl-bar" aria-hidden><u style={{ width: `${Math.max(4, Math.round((dur / maxDur) * 100))}%` }} /></i>}
                </NickButton>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((p, idx) => {
            const dur = p.since != null ? now - p.since : null;
            const rank = rankById(p.rankId);
            const isFresh = dur != null && dur < FRESH_MS;
            const prevFresh = idx > 0 && shown[idx - 1].since != null && now - (shown[idx - 1].since as number) < FRESH_MS;
            const heading = grouped && (idx === 0 || prevFresh !== isFresh) ? (isFresh ? 'Только зашли' : 'Давно в игре') : null;
            const top = !limit && sort === 'longest' && !query.trim() && total >= 4 && idx < 3 && dur != null && !isFresh;
            const expandable = !limit;
            const isOpen = expandable && open === p.key;
            const inner = (
              <>
                <Avatar name={p.name} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-bold" title={p.name}>{p.name}</span>
                    {rank && (
                      <span className="pl-rk" title={t('vr.rank.tip', { name: rankName(rank), hours: rank.minHours })}>
                        <RankEmblem rank={rank} size={22} />
                        <span className="pl-rk-n">{rankName(rank)}</span>
                      </span>
                    )}
                    {dur != null && dur < NEWBIE_MS && <span className="pill pill-ok px-2! py-0! text-xs">новичок</span>}
                    {expandable && (known.get(p.name.toLowerCase()) ?? 0) > 0 && <span className="pl-place-chip" title="Место в рейтинге недели">#{known.get(p.name.toLowerCase())}</span>}
                  </span>
                  {dur != null && (
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {expandable && p.since != null && <span className="text-xs font-semibold text-mute">{t('srv.pl.joined', { time: joinedAt(p.since, now) })}</span>}
                      {!rank && dur != null && dur >= VETERAN_MS && <span className="pill pill-warn px-2! py-0! text-xs">ветеран</span>}
                    </span>
                  )}
                </span>
                <span className="pl-time shrink-0 text-right text-sm font-semibold text-mute">
                  {p.since != null ? playedFor(p.since, now) : expandable ? 'в сети сейчас' : ''}
                  {expandable && dur != null && <i className="pl-bar" aria-hidden><u style={{ width: `${Math.max(4, Math.round((dur / maxDur) * 100))}%` }} /></i>}
                </span>
                {expandable && (
                  <svg className="pl-chev" data-open={isOpen} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                )}
              </>
            );
            return (
              <Fragment key={p.key}>
              {heading && <li className="pl-group" aria-hidden>{heading}</li>}
              <li className={`min-w-0 ${top ? 'pl-top' : ''} ${fresh.has(p.name) ? 'player-new' : ''}`}>
                {expandable ? (
                  <NickButton name={p.name} className="pl-row" expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.key)}>{inner}</NickButton>
                ) : (
                  <div className="flex min-w-0 items-center gap-3 rounded-xl py-2">{inner}</div>
                )}
                {isOpen && (
                  <dl className="pl-more">
                    <div>
                      <dt>В игре</dt>
                      <dd>{p.since != null ? playedFor(p.since, now) : 'в сети сейчас'}</dd>
                    </div>
                    <div>
                      <dt>Зашёл</dt>
                      <dd>{p.since != null ? clock(p.since) : 'нет данных'}</dd>
                    </div>
                    {known.has(p.name.toLowerCase()) && (
                      <div className="col-span-2">
                        <dt>Профиль</dt>
                        <dd><a className="font-extrabold text-link hover:underline" href={`/player/${encodeURIComponent(p.name)}`}>Открыть профиль игрока →</a></dd>
                      </div>
                    )}
                    <div className="col-span-2">
                      <dt>Ник</dt>
                      <dd className="flex items-center gap-2">
                        <span className="min-w-0 break-all">{p.name}</span>
                        <button
                          type="button"
                          className="btn btn-soft btn-sm shrink-0"
                          onClick={() => void navigator.clipboard?.writeText(p.name).then(() => toast(t('srv.pl.copied')), () => undefined)}
                        >
                          Копировать
                        </button>
                      </dd>
                    </div>
                  </dl>
                )}
              </li>
              </Fragment>
            );
          })}
          {gone.filter((g) => !query.trim() || g.name.toLowerCase().includes(query.trim().toLowerCase())).map((g) => (
            <li key={`gone-${g.key}`} className="pl-gone" aria-hidden>
              <div className="flex min-w-0 items-center gap-3 rounded-xl px-1.5 py-2">
                <Avatar name={g.name} />
                <span className="min-w-0 flex-1 truncate font-bold">{g.name}</span>
                <span className="text-sm font-semibold text-mute">вышел</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!limit && shown.length < rows.length && (
        <button type="button" className="btn btn-soft btn-sm mt-3" onClick={() => setPages((n) => n + 1)}>Показать ещё {Math.min(PAGE, rows.length - shown.length)} из {rows.length - shown.length}</button>
      )}
      {hiddenCount > 0 && limit && (total > limit || hiddenCount > 0) && moreHref && (
        <a href={moreHref} className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-extrabold text-link hover:underline md:min-h-0">
          Показать всех {players > total ? players : total} →
        </a>
      )}
      {!hiddenCount && limit && total > limit && moreHref && (
        <a href={moreHref} className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-extrabold text-link hover:underline md:min-h-0">
          Показать всех {total} →
        </a>
      )}
    </div>
  );
}

/** three small record cards over the player list: the peak, the average and the longest session on the server now */
export function PlayerFacts({ peak, peakAt, avg, windowLabel, list }: { peak: number | null; peakAt: number | null; avg: number | null; windowLabel: string; list: PlayerNow[] }) {
  const now = useNow(30_000);
  const longest = list.reduce<PlayerNow | null>((a, p) => (p.since != null && (a == null || (a.since as number) > p.since) ? p : a), null);
  if (peak == null && avg == null && !longest) return null;
  return (
    <div className="pl-facts">
      {peak != null && (
        <div className="pl-fact">
          <span className="pl-fact-k">Рекорд онлайна</span>
          <b className="pl-fact-v">{peak}</b>
          <span className="pl-fact-h">{peakAt ? fmtDateTime(peakAt) : windowLabel}</span>
        </div>
      )}
      {avg != null && (
        <div className="pl-fact">
          <span className="pl-fact-k">В среднем</span>
          <b className="pl-fact-v">{Math.round(avg * 10) / 10}</b>
          <span className="pl-fact-h">{windowLabel}</span>
        </div>
      )}
      {longest && longest.since != null && (
        <div className="pl-fact">
          <span className="pl-fact-k">Дольше всех в игре</span>
          <b className="pl-fact-v">{playedFor(longest.since, now)}</b>
          <span className="pl-fact-h truncate" title={longest.name}>{longest.name}</span>
        </div>
      )}
    </div>
  );
}

/** how long the players on the server have been in the game: a small bar chart in six steps */
export function SessionSpread({ list, now }: { list: PlayerNow[]; now: number }) {
  const withTime = list.filter((p) => p.since != null);
  if (withTime.length < 3) return null;
  const steps: [string, number][] = [['<10 м', 10], ['10–30 м', 30], ['30–60 м', 60], ['1–2 ч', 120], ['2–4 ч', 240], ['4 ч+', Infinity]];
  const counts = steps.map(() => 0);
  for (const p of withTime) {
    const min = (now - (p.since as number)) / 60_000;
    counts[steps.findIndex(([, hi]) => min < hi)] += 1;
  }
  const top = Math.max(...counts, 1);
  return (
    <div className="pl-spread" role="img" aria-label={`Время в игре: ${steps.map(([l], i) => `${l} ${counts[i]}`).join(', ')}`}>
      <span className="pl-spread-k">Сколько уже играют</span>
      <div className="pl-spread-bars">
        {steps.map(([label], i) => (
          <span key={label} className="pl-spread-c" title={`${label}: ${counts[i]}`}>
            <i style={{ height: `${Math.max(counts[i] ? 12 : 3, Math.round((counts[i] / top) * 100))}%` }} data-on={counts[i] ? '1' : undefined} />
            <small>{label}</small>
            <b>{counts[i] || ''}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
