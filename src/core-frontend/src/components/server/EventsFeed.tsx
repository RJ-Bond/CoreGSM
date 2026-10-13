import { useMemo, useState } from 'react';
import type { ServerDetails } from '../../api';
import { ago, plural } from '../../ui';
import { fmtDuration } from './helpers';

type Ev = ServerDetails['events'][number];
type Filter = 'all' | 'fail' | 'peak';

const dayKey = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function dayTitle(ts: number): string {
  const d = new Date(ts);
  const t = new Date();
  if (dayKey(ts) === dayKey(t.getTime())) return 'Сегодня';
  const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
  if (dayKey(ts) === dayKey(y.getTime())) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
}
const absTime = (ts: number) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const clock = (ts: number) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const ICON: Record<Ev['type'], { cls: string; path: string }> = {
  up: { cls: 'bg-okbg text-ok', path: 'M5 12.5l4.5 4.5L19 7.5' },
  down: { cls: 'bg-badbg text-bad', path: 'M12 5v10M7 12l5 5 5-5' },
  peak: { cls: 'bg-soft text-link', path: 'M3 17l6-6 4 4 8-8M15 7h6v6' },
  maintenance: { cls: 'bg-soft text-link', path: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' },
};

function title(e: Ev, downFor: number | null, stillDown: boolean): string {
  if (e.type === 'up') return 'Сервер вернулся';
  if (e.type === 'peak') return `Пик игроков: ${e.players ?? '–'}`;
  if (e.type === 'maintenance') return e.name ? `Начались технические работы: ${e.name}` : 'Начались технические работы';
  if (downFor != null) return `Сервер упал · был недоступен ${fmtDuration(downFor)}`;
  return stillDown ? 'Сервер упал · недоступен до сих пор' : 'Сервер упал';
}

export default function EventsFeed({ events, online, limit, moreHref }: { events: Ev[]; online: boolean; limit?: number; moreHref?: string }) {
  const [filter, setFilter] = useState<Filter>('all');

  // how long every outage lasted: the nearest later 'up'
  const downFor = useMemo(() => {
    const m = new Map<number, number>();
    const ups = events.filter((e) => e.type === 'up').map((e) => e.ts).sort((a, b) => a - b);
    for (const e of events) {
      if (e.type !== 'down') continue;
      const up = ups.find((t) => t > e.ts);
      if (up != null) m.set(e.ts, up - e.ts);
    }
    return m;
  }, [events]);
  const newestDown = events.find((e) => e.type === 'down' || e.type === 'up');
  const failCount = events.filter((e) => e.type === 'down').length;
  const peakCount = events.filter((e) => e.type === 'peak').length;

  const list = events.filter((e) => (filter === 'all' ? true : filter === 'peak' ? e.type === 'peak' : e.type !== 'peak'));
  const shown = limit ? list.slice(0, limit) : list;

  const groups: { key: string; title: string; items: Ev[] }[] = [];
  for (const e of shown) {
    const k = dayKey(e.ts);
    const g = groups[groups.length - 1];
    if (g && g.key === k) g.items.push(e);
    else groups.push({ key: k, title: dayTitle(e.ts), items: [e] });
  }

  const chips: [Filter, string, number][] = [['all', 'Все', events.length], ['fail', 'Сбои', failCount], ['peak', 'Пики', peakCount]];

  return (
    <div>
      {!limit && (
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Фильтр событий">
          {chips.map(([k, label, n]) => (
            <button key={k} type="button" className={`chip-filter ${filter === k ? 'on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label}<span className="opacity-70"> {n}</span>
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-okbg text-ok" aria-hidden>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          </span>
          <p className="font-extrabold">{filter === 'peak' ? 'Пиков за период пока не было' : 'За период сбоев не было'}</p>
          <p className="max-w-xs text-sm font-semibold text-mute">{filter === 'peak' ? 'Рекорд появится, когда на сервере соберутся игроки.' : 'Сервер отвечал всё время: событий для показа нет.'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.title}>
              <h3 className="mb-1.5 text-[13px] font-extrabold uppercase tracking-wide text-mute">{g.title}</h3>
              <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[17px] before:top-3 before:w-px before:bg-line">
                {g.items.map((e) => {
                  const ic = ICON[e.type];
                  return (
                    <li key={`${e.type}-${e.ts}`} className="relative flex min-w-0 items-center gap-3 rounded-xl py-1.5">
                      <span className={`relative z-[1] grid h-9 w-9 shrink-0 place-items-center rounded-full ${ic.cls}`} aria-hidden>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d={ic.path} /></svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold leading-snug">{title(e, downFor.get(e.ts) ?? null, !online && newestDown === e)}</span>
                        <time dateTime={new Date(e.ts).toISOString()} title={absTime(e.ts)} className="text-sm font-semibold text-mute">
                          {ago(e.ts)} · {clock(e.ts)}
                        </time>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
      {limit && list.length > 0 && moreHref && (
        <a href={moreHref} className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-extrabold text-link hover:underline md:min-h-0">
          Все события →<span className="font-semibold text-mute">· {events.length} {plural(events.length, ['событие', 'события', 'событий'])}</span>
        </a>
      )}
    </div>
  );
}
