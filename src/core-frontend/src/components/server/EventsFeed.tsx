import { useMemo, useState } from 'react';
import type { ServerDetails } from '../../api';
import { StateView } from '../StateView';
import { t, useI18n } from '../../i18n';
import { ago, plural } from '../../ui';
import { fmtDuration } from './helpers';
import { EVENT_FILTERS, eventCounts, filterEvents, groupByDay, type EventFilter } from './serverLogic';

type Ev = ServerDetails['events'][number];
const dayTitle = (kind: 'today' | 'yesterday' | 'date', ts: number): string =>
  kind === 'today' ? t('srv.ev.today') : kind === 'yesterday' ? t('srv.ev.yesterday')
    : new Date(ts).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
const FILTER_KEY: Record<EventFilter, 'srv.ev.all' | 'srv.ev.down' | 'srv.ev.up' | 'srv.ev.peak' | 'srv.ev.maint'> = {
  all: 'srv.ev.all', down: 'srv.ev.down', up: 'srv.ev.up', peak: 'srv.ev.peak', maintenance: 'srv.ev.maint',
};
const absTime = (ts: number) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const clock = (ts: number) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const ICON: Record<Ev['type'], { cls: string; path: string }> = {
  up: { cls: 'bg-okbg text-ok', path: 'M5 12.5l4.5 4.5L19 7.5' },
  down: { cls: 'bg-badbg text-bad', path: 'M12 5v10M7 12l5 5 5-5' },
  peak: { cls: 'bg-soft text-link', path: 'M3 17l6-6 4 4 8-8M15 7h6v6' },
  maintenance: { cls: 'bg-soft text-link', path: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' },
};

const MARK_RU: Record<Ev['type'], string> = { up: 'возврат', down: 'сбой', peak: 'пик', maintenance: 'тех. работы' };

function title(e: Ev, downFor: number | null, stillDown: boolean): string {
  if (e.type === 'up') return 'Сервер вернулся';
  if (e.type === 'peak') return `Пик игроков: ${e.players ?? '–'}`;
  if (e.type === 'maintenance') return e.name ? `Начались технические работы: ${e.name}` : 'Начались технические работы';
  if (downFor != null) return `Сервер упал · был недоступен ${fmtDuration(downFor)}`;
  return stillDown ? 'Сервер упал · недоступен до сих пор' : 'Сервер упал';
}

export default function EventsFeed({ events, online, limit, moreHref, uptimePct, windowLabel }: { events: Ev[]; online: boolean; limit?: number; moreHref?: string; uptimePct?: number | null; windowLabel?: string }) {
  useI18n();
  const [filter, setFilter] = useState<EventFilter>('all');

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
  const counts = eventCounts(events);
  const list = filterEvents(events, filter);
  const shown = limit ? list.slice(0, limit) : list;
  const groups = groupByDay(shown).map((g) => ({ ...g, title: dayTitle(g.kind, g.ts) }));

  const outages = events.filter((e) => e.type === 'down').length;
  const downTotal = [...downFor.values()].reduce((a, b) => a + b, 0);
  return (
    <div>
      {!limit && events.length > 0 && (
        <div className="ev-sum">
          <div className="ev-sum-c"><b>{outages}</b><span>{plural(outages, ['сбой', 'сбоя', 'сбоев'])}</span></div>
          <div className="ev-sum-c"><b>{downTotal ? fmtDuration(downTotal) : '0'}</b><span>суммарный простой</span></div>
          {uptimePct != null && <div className="ev-sum-c"><b>{Math.round(uptimePct * 10) / 10}%</b><span>доступность{windowLabel ? ` ${windowLabel}` : ''}</span></div>}
        </div>
      )}
      {!limit && (
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={t('srv.ev.filter')}>
          {EVENT_FILTERS.map((k) => (
            <button key={k} type="button" className={`chip-filter ${filter === k ? 'on' : ''} ${k !== 'all' && counts[k] === 0 && filter !== k ? 'is-zero' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {t(FILTER_KEY[k])}<span className="ml-1 opacity-70">{counts[k]}</span>
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <StateView
          kind="empty"
          bare
          compact
          title={filter === 'all' ? t('srv.ev.emptyAll') : filter === 'peak' ? t('srv.ev.emptyPeak') : filter === 'maintenance' ? t('srv.ev.emptyMaint') : filter === 'up' ? t('srv.ev.emptyUp') : t('srv.ev.emptyDown')}
          text={filter === 'all' ? t('srv.ev.emptyAllText') : filter === 'peak' ? t('srv.ev.emptyPeakText') : t('srv.ev.emptyFilterText')}
        />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.title}>
              <h3 className="mb-1.5 text-fs-sm font-extrabold uppercase tracking-wide text-mute">{g.title}</h3>
              <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[17px] before:top-3 before:w-px before:bg-line">
                {g.items.map((e) => {
                  const ic = ICON[e.type];
                  return (
                    <li key={`${e.type}-${e.ts}`} className="relative flex min-w-0 items-center gap-3 rounded-xl py-1.5">
                      <span className={`relative z-1 grid h-9 w-9 shrink-0 place-items-center rounded-full ${ic.cls}`} aria-hidden>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d={ic.path} /></svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className={`ev-type ev-${e.type}`}>{MARK_RU[e.type]}</span>
                          <span className="block font-bold leading-snug">{title(e, downFor.get(e.ts) ?? null, !online && newestDown === e)}</span>
                        </span>
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
