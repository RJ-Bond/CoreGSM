import { useEffect, useState } from 'react';
import { api } from '../api';
import { t, useI18n, type TKey } from '../i18n';
import { LineChart, Section, fmtTime } from '../ui';

export interface HealthSample { ts: number; dbBytes: number | null; rssMb: number | null; pollMs: number | null; pollFailures: number | null; botState: string | null; queueLen: number | null; diskFree: number | null; loadPct?: number | null }
export interface HealthFlag { kind: 'bot_offline' | 'poll_slow' | 'disk_low' | 'db_growing' | string; since: number; text: string }
interface HistoryResponse { samples: HealthSample[]; flags: HealthFlag[] }

const PERIODS = [
  { hours: 24, n: 24, unit: 'h' },
  { hours: 168, n: 7, unit: 'd' },
  { hours: 336, n: 14, unit: 'd' },
] as const;

const mbText = (bytes: number) => t('d2.sys.mb', { v: (bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0).replace('.', ',') });
const msText = (ms: number) => (ms >= 10_000 ? t('dur.s', { n: Math.round(ms / 1000) }) : ms >= 1000 ? t('dur.s', { n: (ms / 1000).toFixed(1).replace('.', ',') }) : t('d2.bot.ms', { n: Math.round(ms) }));

const METRICS: { id: string; title: TKey; pick: (s: HealthSample) => number | null; fmt: (n: number) => string }[] = [
  { id: 'poll', title: 'd2.hhc.poll', pick: (s) => s.pollMs, fmt: msText },
  { id: 'cpu', title: 'd2.sys.cpu.load', pick: (s) => s.loadPct ?? null, fmt: (n) => `${Math.round(n)} %` },
  { id: 'mem', title: 'd2.sys.mem.label', pick: (s) => s.rssMb, fmt: (n) => t('d2.sys.mb', { v: Math.round(n) }) },
  { id: 'db', title: 'd2.hhc.dbSize', pick: (s) => s.dbBytes, fmt: mbText },
  { id: 'queue', title: 'd2.hhc.queue', pick: (s) => s.queueLen, fmt: (n) => String(Math.round(n)) },
];

/** «Состояние за период»: four static sparklines of the panel's own health. Hidden when the backend has no history. */
export default function HealthHistoryCard({ onFlags }: { onFlags?: (f: HealthFlag[]) => void }) {
  useI18n();
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
      title={t('d2.hhc.title')}
      description={first ? t('d2.hhc.since', { when: fmtTime(first), n: samples.length }) : t('d2.hhc.desc')}
      actions={(
        <div className="seg" role="group" aria-label={t('st.range')}>
          {PERIODS.map((p) => (
            <button key={p.hours} type="button" className={`seg-item ${hours === p.hours ? 'on' : ''}`} aria-pressed={hours === p.hours} onClick={() => setHours(p.hours)}>{p.unit === 'h' ? t('dur.h', { n: p.n }) : t('d2.hhc.d', { n: p.n })}</button>
          ))}
        </div>
      )}
    >
      {!data ? (
        <div className="skeleton h-40 rounded-ui-lg" aria-busy="true" aria-label={t('d2.news.loading')} />
      ) : samples.length < 2 ? (
        <p className="text-sm font-semibold text-mute">{t('d2.hhc.few')}</p>
      ) : (
        <div className="grid gap-3 min-[520px]:grid-cols-2">
          {METRICS.map((m) => <LineChart key={m.id} title={t(m.title)} points={samples.map((x) => ({ ts: x.ts, v: m.pick(x) }))} fmt={m.fmt} height={96} floor={m.id === 'db' || m.id === 'mem'} />)}
        </div>
      )}
    </Section>
  );
}
