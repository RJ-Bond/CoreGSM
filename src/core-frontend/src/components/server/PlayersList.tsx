import { useMemo, useState } from 'react';
import type { PlayerNow } from '../../api';
import { plural } from '../../ui';
import { NEWBIE_MS, VETERAN_MS, nickHue, nickInitial, playedFor, useNow } from './helpers';

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

type Sort = 'time' | 'alpha';

/**
 * Players on the server. `limit`: overview mode (first N, no search, link to the full list via `moreHref`).
 * `fresh`: names that appeared since the previous poll (a short highlight).
 */
export default function PlayersList({
  online, players, names, list, fresh, limit, moreHref,
}: { online: boolean; players: number; names: string[]; list: PlayerNow[]; fresh: Set<string>; limit?: number; moreHref?: string }) {
  const now = useNow(30_000);
  const [sort, setSort] = useState<Sort>('time');
  const [query, setQuery] = useState('');

  const total = list.length || names.length;
  const hiddenCount = Math.max(0, players - total);
  const rows = useMemo(() => {
    let r = list.map((p) => ({ name: p.name || 'Без имени', since: p.since as number | null }));
    if (!r.length) r = names.map((n) => ({ name: n || 'Без имени', since: null }));
    const q = query.trim().toLowerCase();
    if (q) r = r.filter((p) => p.name.toLowerCase().includes(q));
    if (sort === 'alpha' || r.every((p) => p.since == null)) r.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    else r.sort((a, b) => (a.since ?? 0) - (b.since ?? 0));
    return r;
  }, [list, names, query, sort]);
  const shown = limit ? rows.slice(0, limit) : rows;
  const showSearch = !limit && total > 8;
  const hasTimes = list.length > 0;

  if (!online) return <p className="py-6 text-center font-semibold text-mute">Сервер недоступен: список игроков появится, когда он вернётся.</p>;
  if (total === 0) {
    return (
      <p className="py-6 text-center font-semibold text-mute">
        {players > 0 ? `Сейчас ${players} ${plural(players, ['игрок', 'игрока', 'игроков'])}, но игра не передаёт имена.` : 'Пока никого нет. Будьте первым!'}
      </p>
    );
  }

  return (
    <div>
      {(showSearch || (!limit && hasTimes && total > 1)) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {showSearch && (
            <input
              type="search"
              className="input !h-10 min-w-0 flex-1 basis-40"
              placeholder="Поиск по нику"
              aria-label="Поиск игрока по нику"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          )}
          {hasTimes && total > 1 && (
            <div className="seg" role="group" aria-label="Сортировка">
              {([['time', 'По времени в игре'], ['alpha', 'По алфавиту']] as [Sort, string][]).map(([k, label]) => (
                <button key={k} type="button" className="seg-item" aria-pressed={sort === k} onClick={() => setSort(k)}>{label}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="py-6 text-center font-semibold text-mute">Никого не нашли по запросу «{query}».</p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((p, i) => {
            const dur = p.since != null ? now - p.since : null;
            return (
              <li key={`${p.name}-${p.since ?? ''}-${i}`} className={`flex min-w-0 items-center gap-3 rounded-xl py-2 ${fresh.has(p.name) ? 'player-new' : ''}`}>
                <Avatar name={p.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold" title={p.name}>{p.name}</span>
                  {dur != null && (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {dur < NEWBIE_MS && <span className="pill pill-ok !px-2 !py-0 text-[11px]">новичок</span>}
                      {dur >= VETERAN_MS && <span className="pill pill-warn !px-2 !py-0 text-[11px]">ветеран</span>}
                    </span>
                  )}
                </span>
                {p.since != null && <span className="shrink-0 text-right text-sm font-semibold text-mute">{playedFor(p.since, now)}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {hiddenCount > 0 && !limit && <p className="mt-2 text-sm font-bold text-mute">и ещё {hiddenCount} без имени</p>}
      {limit && (total > limit || hiddenCount > 0) && moreHref && (
        <a href={moreHref} className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-extrabold text-link hover:underline md:min-h-0">
          Показать всех {players > total ? players : total} →
        </a>
      )}
    </div>
  );
}
