import { useEffect, useState } from 'react';
import { api } from '../api';
import { buildSparkline, downsample } from '../sparkline';
import { Section, fmtTime } from '../ui';

export interface HealthSample { ts: number; dbBytes: number | null; rssMb: number | null; pollMs: number | null; pollFailures: number | null; botState: string | null; queueLen: number | null; diskFree: number | null }
export interface HealthFlag { kind: 'bot_offline' | 'poll_slow' | 'disk_low' | 'db_growing' | string; since: number; text: string }
interface HistoryResponse { samples: HealthSample[]; flags: HealthFlag[] }

const PERIODS = [
  { hours: 24, label: '24 ч' },
  { hours: 168, label: '7 д' },
  { hours: 336, label: '14 д' },
] as const;

const mbText = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0).replace('.', ',')} МБ`;
const msText = (ms: number) => (ms >= 10_000 ? `${Math.round(ms / 1000)} с` : ms >= 1000 ? `${(ms / 1000).toFixed(1).replace('.', ',')} с` : `${Math.round(ms)} мс`);

const METRICS: { id: string; title: string; pick: (s: HealthSample) => number | null; fmt: (n: number) => string }[] = [
  { id: 'poll', title: 'Длительность опроса', pick: (s) => s.pollMs, fmt: msText },
  { id: 'mem', title: 'Память панели', pick: (s) => s.rssMb, fmt: (n) => `${Math.round(n)} МБ` },
  { id: 'db', title: 'Размер базы', pick: (s) => s.dbBytes, fmt: mbText },
  { id: 'queue', title: 'Очередь доставки', pick: (s) => s.queueLen, fmt: (n) => String(Math.round(n)) },
];

const W = 220;
const H = 48;

function Sparkline({ title, values, fmt }: { title: string; values: (number | null)[]; fmt: (n: number) => string }) {
  const sp = buildSparkline(downsample(values, 120), W, H);
  return (
    <div className="rounded-ui-lg bg-soft p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-extrabold text-mute">{title}</span>
        <span className="font-black tabular-nums">{sp.last == null ? '–' : fmt(sp.last)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 block h-12 w-full" role="img" aria-label={sp.empty ? `${title}: данных нет` : `${title}: сейчас ${fmt(sp.last ?? 0)}, от ${fmt(sp.min)} до ${fmt(sp.max)}`} preserveAspectRatio="none">
        {!sp.empty && <path d={sp.area} className="fill-link" opacity="0.12" />}
        {!sp.empty && <path d={sp.path} fill="none" className="stroke-link" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="mt-1 flex justify-between text-xs font-bold text-mute">
        <span>{sp.empty ? 'нет данных' : `мин ${fmt(sp.min)}`}</span>
        <span>{sp.empty ? '' : `макс ${fmt(sp.max)}`}</span>
      </div>
    </div>
  );
}

/** «Состояние за период»: four static sparklines of the panel's own health. Hidden when the backend has no history. */
export default function HealthHistoryCard({ onFlags }: { onFlags?: (f: HealthFlag[]) => void }) {
  const [hours, setHours] = useState<number>(24);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [gone, setGone] = useState(false);

  // the period changed or a minute passed: ask again (an answer for a previous period is dropped)
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<HistoryResponse>(`/system/health-history?hours=${hours}`)
        .then((r) => { if (alive) { setData({ samples: Array.isArray(r.samples) ? r.samples : [], flags: Array.isArray(r.flags) ? r.flags : [] }); setGone(false); } })
        .catch(() => { if (alive) setGone(true); });
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [hours]);
  useEffect(() => { if (data) onFlags?.(data.flags); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [data]);

  if (gone && !data) return null;
  const samples = data?.samples ?? [];
  const first = samples[0]?.ts;

  return (
    <Section
      title="Состояние за период"
      description={first ? `Замеры с ${fmtTime(first)}: ${samples.length}` : 'Как панель чувствовала себя последнее время.'}
      actions={(
        <div className="seg" role="group" aria-label="Период">
          {PERIODS.map((p) => (
            <button key={p.hours} type="button" className={`seg-item ${hours === p.hours ? 'on' : ''}`} aria-pressed={hours === p.hours} onClick={() => setHours(p.hours)}>{p.label}</button>
          ))}
        </div>
      )}
    >
      {!data ? (
        <div className="skeleton h-40 rounded-ui-lg" aria-busy="true" aria-label="Загрузка" />
      ) : samples.length < 2 ? (
        <p className="text-sm font-semibold text-mute">Замеров пока мало: график появится через несколько минут работы панели.</p>
      ) : (
        <div className="grid gap-3 min-[520px]:grid-cols-2">
          {METRICS.map((m) => <Sparkline key={m.id} title={m.title} values={samples.map(m.pick)} fmt={m.fmt} />)}
        </div>
      )}
    </Section>
  );
}
