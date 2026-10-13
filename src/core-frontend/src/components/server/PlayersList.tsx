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
interface Row { key: string; name: string; since: number | null }

const clock = (ts: number) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Players on the server. `limit`: overview mode (first N, no search, link to the full list via `moreHref`).
 * `fresh`: names that appeared since the previous poll (a short highlight).
 * Full mode: a count header, search, sort, and every row expands into a small card.
 */
export default function PlayersList({
  online, players, names, list, fresh, limit, moreHref,
}: { online: boolean; players: number; names: string[]; list: PlayerNow[]; fresh: Set<string>; limit?: number; moreHref?: string }) {
  const now = useNow(30_000);
  const [sort, setSort] = useState<Sort>('time');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const total = list.length || names.length;
  const hiddenCount = Math.max(0, players - total);
  const rows = useMemo(() => {
    let r: Row[] = list.map((p, i) => ({ key: `${p.name}-${p.since}-${i}`, name: p.name || 'Без имени', since: p.since as number | null }));
    if (!r.length) r = names.map((n, i) => ({ key: `${n}-${i}`, name: n || 'Без имени', since: null }));
    const q = query.trim().toLowerCase();
    if (q) r = r.filter((p) => p.name.toLowerCase().includes(q));
    if (sort === 'alpha' || r.every((p) => p.since == null)) r.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    else r.sort((a, b) => (a.since ?? 0) - (b.since ?? 0));
    return r;
  }, [list, names, query, sort]);
  const shown = limit ? rows.slice(0, limit) : rows;
  const showSearch = !limit && total > 5;
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
      {!limit && (
        <p className="mb-3 text-sm font-bold text-mute" aria-live="polite">
          {query.trim()
            ? `Найдено ${rows.length} из ${total}`
            : `${total} ${plural(total, ['игрок', 'игрока', 'игроков'])} с именами${hiddenCount > 0 ? ` · ещё ${hiddenCount} без имени` : ''}`}
        </p>
      )}
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
          {total > 1 && (
            <div className="seg" role="group" aria-label="Сортировка">
              {([['time', 'По времени в игре'], ['alpha', 'По алфавиту']] as [Sort, string][])
                .filter(([k]) => k === 'alpha' || hasTimes)
                .map(([k, label]) => (
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
          {shown.map((p) => {
            const dur = p.since != null ? now - p.since : null;
            const expandable = !limit;
            const isOpen = expandable && open === p.key;
            const inner = (
              <>
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
                          onClick={() => void navigator.clipboard?.writeText(p.name).catch(() => undefined)}
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
