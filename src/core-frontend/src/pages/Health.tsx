import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { buildChart, shareOf, stateSegments } from '../healthChart';
import { downsample } from '../sparkline';
import { t, useI18n } from '../i18n';
import { AdminPage, IconHealth, PageHead, Section, StateView, errorKind, fmtDateTime, fmtTime } from '../ui';

interface Sample { ts: number; dbBytes: number | null; rssMb: number | null; pollMs: number | null; pollFailures: number | null; botState: string | null; queueLen: number | null; diskFree: number | null; loadPct?: number | null }
interface Flag { kind: string; since: number; text: string }
interface Thresholds { pollIntervalMs: number; pollSlowMs: number; diskLowBytes: number }
interface Resp { samples: Sample[]; flags: Flag[]; thresholds?: Thresholds }

const PERIODS = [24, 168, 336] as const;
const MB = 1048576;
const GB = 1073741824;
const num = (n: number, d = 1) => n.toFixed(d).replace(/\.0+$/, '').replace('.', ',');
const ms = (n: number) => (n >= 1000 ? `${num(n / 1000)} ${t('hl.u.s')}` : `${Math.round(n)} ${t('hl.u.ms')}`);
const mb = (n: number) => (n >= 1024 * MB ? `${num(n / GB, 2)} ${t('hl.u.gb')}` : `${num(n / MB, n < 10 * MB ? 1 : 0)} ${t('hl.u.mb')}`);
const botBad = (s: string) => s === 'offline' || s === 'error';

const W = 640;
const H = 150;

function Chart({ title, hint, values, fmt, limit, lowIsBad, floor }: { title: string; hint?: string; values: (number | null)[]; fmt: (n: number) => string; limit?: number; lowIsBad?: boolean; floor?: boolean }) {
  const c = useMemo(() => buildChart(downsample(values, 160), W, H, { limit, floor }), [values, limit, floor]);
  const breach = c.last != null && limit != null && (lowIsBad ? c.last < limit : c.last > limit);
  return (
    <div className={`rounded-ui-lg bg-soft p-4 ${breach ? 'ring-2 ring-bad' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-extrabold">{title}</h3>
        <span className={`text-xl font-black tabular-nums ${breach ? 'text-bad' : ''}`}>{c.last == null ? '–' : fmt(c.last)}</span>
      </div>
      {hint && <p className="text-sm font-semibold text-mute">{hint}</p>}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-2 block h-36 w-full" role="img" aria-label={c.empty ? t('hl.noData') : t('hl.chartAria', { title, now: fmt(c.last ?? 0), min: fmt(c.min), max: fmt(c.max) })}>
        {!c.empty && <path d={c.area} className="fill-link" opacity="0.14" />}
        {!c.empty && <path d={c.path} fill="none" className="stroke-link" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        {c.limitY != null && <line x1="0" x2={W} y1={c.limitY} y2={c.limitY} className="stroke-bad" strokeWidth="1.5" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-xs font-bold text-mute">
        <span>{c.empty ? t('hl.noData') : `${t('hl.min')} ${fmt(c.min)} · ${t('hl.max')} ${fmt(c.max)}`}</span>
        {limit != null && <span className="text-bad">{t(lowIsBad ? 'hl.limitLow' : 'hl.limit', { v: fmt(limit) })}</span>}
      </div>
    </div>
  );
}

const STATE_TONE = (s: string) => (botBad(s) ? 'bg-bad' : s === 'none' || s === 'unknown' ? 'bg-line' : 'bg-ok');

function BotStrip({ samples, end }: { samples: Sample[]; end: number }) {
  const segs = useMemo(() => stateSegments(samples, end), [samples, end]);
  if (!segs.length) return null;
  const from = segs[0].from;
  const total = Math.max(1, end - from);
  const up = shareOf(segs, (s) => !botBad(s));
  return (
    <div className="rounded-ui-lg bg-soft p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-extrabold">{t('hl.bot')}</h3>
        <span className="text-xl font-black tabular-nums">{Math.round(up * 1000) / 10}%</span>
      </div>
      <p className="text-sm font-semibold text-mute">{t('hl.botHint')}</p>
      <div className="mt-2 flex h-5 overflow-hidden rounded-full" role="img" aria-label={t('hl.botAria', { p: Math.round(up * 1000) / 10 })}>
        {segs.map((s) => <span key={s.from} className={STATE_TONE(s.state)} style={{ width: `${((s.to - s.from) / total) * 100}%` }} title={`${s.state}: ${fmtTime(s.from)} – ${fmtTime(s.to)}`} />)}
      </div>
      <div className="mt-1 flex justify-between text-xs font-bold text-mute"><span>{fmtDateTime(from)}</span><span>{fmtDateTime(end)}</span></div>
    </div>
  );
}

export default function HealthPage() {
  useI18n();
  const [hours, setHours] = useState<number>(24);
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => api<Resp>(`/system/health-history?hours=${hours}`)
      .then((r) => { if (alive) { setData(r); setError(''); } })
      .catch((e: Error) => { if (alive) setError(e.message || t('common.error')); });
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, [hours, nonce]);

  const samples = data?.samples ?? [];
  const th = data?.thresholds;
  const col = <K extends keyof Sample>(k: K) => samples.map((s) => (s[k] as number | null) ?? null);
  const end = samples.length ? samples[samples.length - 1].ts : 0;

  return (
    <AdminPage
      head={(
        <PageHead icon={<IconHealth />} title={t('hl.title')} subtitle={t('hl.sub')} hint={t('hl.hint')}>
          <div className="seg" role="group" aria-label={t('hl.period')}>
            {PERIODS.map((p) => <button key={p} type="button" className="seg-item" aria-pressed={hours === p} onClick={() => setHours(p)}>{p === 24 ? t('hl.p24') : p === 168 ? t('hl.p7') : t('hl.p14')}</button>)}
          </div>
        </PageHead>
      )}
    >
      {error && !data ? <StateView kind={errorKind(error)} text={errorKind(error) === 'error' ? error : undefined} onRetry={() => setNonce((n) => n + 1)} /> : !data ? (
        <div className="skeleton panel h-64" aria-busy="true" aria-label={t('hl.loading')} />
      ) : (
        <>
          <Section title={t('hl.flags')}>
            {data.flags.length === 0 ? (
              <p className="flex items-center gap-2 font-bold"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-ok" />{t('hl.allGood')}</p>
            ) : (
              <ul className="space-y-2">
                {data.flags.map((f) => (
                  <li key={f.kind} className="rounded-2xl bg-badbg px-4 py-2.5 font-bold text-bad" role="alert">{f.text}<span className="ml-2 text-sm font-semibold opacity-80">{t('hl.since', { t: fmtDateTime(f.since) })}</span></li>
                ))}
              </ul>
            )}
          </Section>
          {samples.length < 2 ? (
            <p className="panel p-5 font-semibold text-mute">{t('hl.few')}</p>
          ) : (
            <>
              <BotStrip samples={samples} end={end} />
              <div className="grid gap-4 lg:grid-cols-2">
                <Chart title={t('hl.poll')} hint={t('hl.pollHint')} values={col('pollMs')} fmt={ms} limit={th?.pollSlowMs} />
                <Chart title={t('hl.disk')} hint={t('hl.diskHint')} values={col('diskFree')} fmt={mb} limit={th?.diskLowBytes} lowIsBad floor />
                <Chart title={t('hl.db')} hint={t('hl.dbHint')} values={col('dbBytes')} fmt={mb} floor />
                <Chart title={t('hl.mem')} values={col('rssMb')} fmt={(n) => `${Math.round(n)} ${t('hl.u.mb')}`} floor />
                <Chart title={t('hl.cpu')} hint={t('hl.cpuHint')} values={col('loadPct')} fmt={(n) => `${Math.round(n)} %`} />
                <Chart title={t('hl.queue')} hint={t('hl.queueHint')} values={col('queueLen')} fmt={(n) => String(Math.round(n))} />
              </div>
              <p className="text-sm font-semibold text-mute">{t('hl.foot', { n: samples.length, t: fmtDateTime(samples[0].ts) })}</p>
            </>
          )}
        </>
      )}
    </AdminPage>
  );
}
