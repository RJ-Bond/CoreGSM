import { useMemo, useState } from 'react';
import type { NewsItem } from '../../api';
import { t, useI18n, type TKey } from '../../i18n';

const MONTHS: TKey[] = ['d2.cal.m.0', 'd2.cal.m.1', 'd2.cal.m.2', 'd2.cal.m.3', 'd2.cal.m.4', 'd2.cal.m.5', 'd2.cal.m.6', 'd2.cal.m.7', 'd2.cal.m.8', 'd2.cal.m.9', 'd2.cal.m.10', 'd2.cal.m.11'];
const DOW: TKey[] = ['cm.dow.0', 'cm.dow.1', 'cm.dow.2', 'cm.dow.3', 'cm.dow.4', 'cm.dow.5', 'cm.dow.6'];

const dateOf = (n: NewsItem): number | null => (n.status === 'sent' || n.status === 'edit_queued' ? n.sentAt ?? n.scheduledAt : n.scheduledAt);
const movable = (n: NewsItem) => n.status === 'scheduled' || n.status === 'draft';
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

const tone = (n: NewsItem) =>
  n.status === 'sent' ? 'bg-okbg text-ok' : n.status === 'scheduled' ? 'bg-warnbg text-warn' : n.status === 'error' ? 'bg-badbg text-bad' : 'bg-soft text-mute';

/** Month grid of scheduled and sent news. Scheduled / draft items can be dragged to another day (time of day is kept). */
export function NewsCalendar({ items, onMove }: { items: NewsItem[]; onMove: (n: NewsItem, day: Date) => void }) {
  useI18n();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const { cells, byDay, undated } = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const byDay = new Map<string, NewsItem[]>();
    const undated: NewsItem[] = [];
    for (const n of items) {
      const t = dateOf(n);
      if (!t) { if (movable(n)) undated.push(n); continue; }
      const k = dayKey(new Date(t));
      byDay.set(k, [...(byDay.get(k) ?? []), n]);
    }
    return { cells, byDay, undated };
  }, [items, month]);

  const todayKey = dayKey(new Date());
  const byId = (id: number) => items.find((n) => n.id === id);
  const chip = (n: NewsItem) => (
    <a
      key={n.id}
      href={`/admin/news/${n.id}`}
      draggable={movable(n)}
      onDragStart={(e) => { setDrag(n.id); e.dataTransfer.setData('text/plain', String(n.id)); e.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={() => { setDrag(null); setOver(null); }}
      title={`${n.title}${movable(n) ? ` (${t('d2.cal.movable')})` : ''}`}
      className={`block truncate rounded-md px-1.5 py-0.5 text-xs font-bold leading-4 ${tone(n)} ${drag === n.id ? 'opacity-50' : ''}`}
      style={{ borderLeft: `3px solid #${(n.payload.embed?.color ?? 0x5865f2).toString(16).padStart(6, '0')}` }}
    >
      {dateOf(n) ? `${new Date(dateOf(n) as number).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} ` : ''}{n.title || t('d2.cal.untitled')}
    </a>
  );

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-black">{t(MONTHS[month.getMonth()])} {month.getFullYear()}</h2>
        <div className="flex items-center gap-1.5">
          <button type="button" className="btn btn-soft btn-sm" aria-label={t('d2.cal.prev')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>←</button>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>{t('d2.jr.today')}</button>
          <button type="button" className="btn btn-soft btn-sm" aria-label={t('d2.cal.next')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>→</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-extrabold uppercase text-mute">{DOW.map((d) => <div key={d}>{t(d)}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d) => {
          const k = dayKey(d);
          const inMonth = d.getMonth() === month.getMonth();
          const list = byDay.get(k) ?? [];
          return (
            <div
              key={k}
              onDragOver={(e) => { if (drag !== null) { e.preventDefault(); setOver(k); } }}
              onDragLeave={() => setOver((o) => (o === k ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const id = drag ?? Number(e.dataTransfer.getData('text/plain'));
                const n = byId(id);
                setDrag(null);
                setOver(null);
                if (n && movable(n)) onMove(n, d);
              }}
              className={`min-h-[72px] rounded-xl border-2 p-1 sm:min-h-[96px] ${over === k ? 'border-brand bg-brand/10' : k === todayKey ? 'border-brand/60' : 'border-line'} ${inMonth ? '' : 'opacity-50'}`}
            >
              <div className={`mb-0.5 text-right text-xs font-extrabold tabular-nums ${k === todayKey ? 'text-link' : 'text-mute'}`}>{d.getDate()}</div>
              <div className="space-y-0.5">{list.slice(0, 3).map(chip)}{list.length > 3 && <div className="text-xs font-bold text-mute">{t('d2.cal.more', { n: list.length - 3 })}</div>}</div>
            </div>
          );
        })}
      </div>
      {undated.length > 0 && (
        <div className="rounded-2xl bg-soft p-3">
          <div className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-mute">{t('d2.cal.undated')}</div>
          <div className="flex flex-wrap gap-1.5">{undated.map((n) => <div key={n.id} className="max-w-[16rem]">{chip(n)}</div>)}</div>
        </div>
      )}
    </div>
  );
}
