import { useMemo, useState } from 'react';
import type { PlayerNow } from '../../api';
import { StateView } from '../StateView';
import { t, useI18n } from '../../i18n';
import { plural, toast } from '../../ui';
import { sortPlayers, type PlayerSort } from './serverLogic';
import { rankById } from '../../vrisingRanks';
import { RankEmblem, rankName } from '../profile/VrRank';
import { NEWBIE_MS, VETERAN_MS, nickHue, nickInitial, playedFor, useNow, useStickyTop } from './helpers';

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span
      className="avatar-hue grid shrink-0 place-items-center rounded-[12px] font-extrabold"
      style={{ ['--h' as string]: nickHue(name), width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {nickInitial(name)}
    </span>
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
  online, players, names, list, fresh, limit, moreHref,
}: { online: boolean; players: number; names: string[]; list: PlayerNow[]; fresh: Set<string>; limit?: number; moreHref?: string }) {
  const now = useNow(30_000);
  useI18n();
  const stickyTop = useStickyTop();
  const [sort, setSort] = useState<PlayerSort>('longest');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const total = list.length || names.length;
  const hiddenCount = Math.max(0, players - total);
  const rows = useMemo(() => {
    let r: Row[] = list.map((p, i) => ({ key: `${p.name}-${p.since}-${i}`, name: p.name || 'Без имени', since: p.since as number | null, rankId: p.rankId }));
    if (!r.length) r = names.map((n, i) => ({ key: `${n}-${i}`, name: n || 'Без имени', since: null }));
    const q = query.trim().toLowerCase();
    if (q) r = r.filter((p) => p.name.toLowerCase().includes(q));
    r = sortPlayers(r, r.every((p) => p.since == null) ? 'alpha' : sort);
    return r;
  }, [list, names, query, sort]);
  const shown = limit ? rows.slice(0, limit) : rows;
  const showSearch = !limit && total > 5;
  const hasTimes = list.length > 0;

  if (!online) {
    return <StateView kind="offline" bare compact title={t('srv.pl.offline')} text={t('srv.pl.offlineText')} />;
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
                  className="input !h-10 min-w-0 flex-1 basis-40"
                  placeholder={t('srv.pl.search')}
                  aria-label={t('srv.pl.searchLabel')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                />
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
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((p) => {
            const dur = p.since != null ? now - p.since : null;
            const rank = rankById(p.rankId);
            const expandable = !limit;
            const isOpen = expandable && open === p.key;
            const inner = (
              <>
                <Avatar name={p.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold" title={p.name}>{p.name}</span>
                  {(dur != null || rank) && (
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {expandable && p.since != null && <span className="text-xs font-semibold text-mute">{t('srv.pl.joined', { time: joinedAt(p.since, now) })}</span>}
                      {dur != null && dur < NEWBIE_MS && <span className="pill pill-ok !px-2 !py-0 text-xs">новичок</span>}
                      {rank && (
                        <span className="inline-flex items-center gap-1 text-xs font-extrabold" style={{ color: rank.color }} title={t('vr.rank.tip', { name: rankName(rank), hours: rank.minHours })}>
                          <RankEmblem rank={rank} size={20} />
                          {rankName(rank)}
                        </span>
                      )}
                      {!rank && dur != null && dur >= VETERAN_MS && <span className="pill pill-warn !px-2 !py-0 text-xs">ветеран</span>}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right text-sm font-semibold text-mute">
                  {p.since != null ? playedFor(p.since, now) : expandable ? 'в сети сейчас' : ''}
                </span>
                {expandable && (
                  <svg className="pl-chev" data-open={isOpen} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                )}
              </>
            );
            return (
              <li key={p.key} className={`min-w-0 ${fresh.has(p.name) ? 'player-new' : ''}`}>
                {expandable ? (
                  <button type="button" className="pl-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.key)}>{inner}</button>
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
            );
          })}
        </ul>
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
