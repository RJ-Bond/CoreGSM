/** Admin: the statistics of one published news item: views by day, reactions, comments. */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { ErrorLine, Modal, fmtDateTime } from '../../ui';

interface Stats { sentAt: number | null; views: number; byDay: { day: string; n: number }[]; reactions: { emoji: string; count: number }[]; comments: number }

/** bars for the views of every day (a plain SVG; the tallest bar is the whole height) */
export function ViewsChart({ days }: { days: { day: string; n: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.n));
  const w = 6;
  const gap = 2;
  return (
    <svg viewBox={`0 0 ${days.length * (w + gap)} 60`} className="h-28 w-full" role="img" aria-label={`Просмотры за ${days.length} дней`} preserveAspectRatio="none">
      {days.map((d, i) => {
        const h = d.n === 0 ? 1 : Math.max(3, (d.n / max) * 56);
        return (
          <rect key={d.day} x={i * (w + gap)} y={58 - h} width={w} height={h} rx={1.5} className={d.n ? 'fill-brand' : 'fill-line'}>
            <title>{`${d.day}: ${d.n}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function NewsStatsModal({ id, title, onClose }: { id: number; title: string; onClose: () => void }) {
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Stats>(`/news/${id}/stats`).then(setS).catch((e: Error) => setError(e.message));
  }, [id]);
  const week = s ? s.byDay.slice(-7).reduce((a, d) => a + d.n, 0) : 0;
  return (
    <Modal title={`Статистика: ${title}`} onClose={onClose}>
      <div className="space-y-4">
        <ErrorLine text={error} />
        {!s && !error && <div className="skeleton h-40 rounded-2xl" />}
        {s && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl bg-soft px-2 py-3"><div className="text-2xl font-black tabular-nums">{s.views}</div><div className="text-xs font-bold text-mute">просмотров</div></div>
              <div className="rounded-2xl bg-soft px-2 py-3"><div className="text-2xl font-black tabular-nums">{week}</div><div className="text-xs font-bold text-mute">за 7 дней</div></div>
              <div className="rounded-2xl bg-soft px-2 py-3"><div className="text-2xl font-black tabular-nums">{s.comments}</div><div className="text-xs font-bold text-mute">комментариев</div></div>
            </div>
            <div>
              <div className="label">Просмотры по дням (30 дней)</div>
              <ViewsChart days={s.byDay} />
              <div className="flex justify-between text-xs font-bold text-mute"><span>{s.byDay[0]?.day}</span><span>{s.byDay[s.byDay.length - 1]?.day}</span></div>
            </div>
            <p className="font-bold">
              Реакции:{' '}
              {s.reactions.length ? s.reactions.map((r) => <span key={r.emoji} className="mr-3">{r.emoji} {r.count}</span>) : <span className="text-mute">пока нет</span>}
            </p>
            {s.sentAt && <p className="text-sm font-semibold text-mute">Опубликовано {fmtDateTime(s.sentAt)}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
