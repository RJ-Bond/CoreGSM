import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { shareOf, stateSegments } from '../healthChart';
import { t, useI18n } from '../i18n';
import { AdminPage, IconHealth, LineChart, PageHead, Section, StateView, errorKind, fmtDateTime, fmtTime } from '../ui';

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
  const col = <K extends keyof Sample>(k: K) => samples.map((s) => ({ ts: s.ts, v: (s[k] as number | null) ?? null }));
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
                <LineChart title={t('hl.poll')} hint={t('hl.pollHint')} points={col('pollMs')} fmt={ms} limit={th?.pollSlowMs} />
                <LineChart title={t('hl.disk')} hint={t('hl.diskHint')} points={col('diskFree')} fmt={mb} limit={th?.diskLowBytes} lowIsBad floor />
                <LineChart title={t('hl.db')} hint={t('hl.dbHint')} points={col('dbBytes')} fmt={mb} floor />
                <LineChart title={t('hl.mem')} points={col('rssMb')} fmt={(n) => `${Math.round(n)} ${t('hl.u.mb')}`} floor />
                <LineChart title={t('hl.cpu')} hint={t('hl.cpuHint')} points={col('loadPct')} fmt={(n) => `${Math.round(n)} %`} />
                <LineChart title={t('hl.queue')} hint={t('hl.queueHint')} points={col('queueLen')} fmt={(n) => String(Math.round(n))} />
              </div>
              <p className="text-sm font-semibold text-mute">{t('hl.foot', { n: samples.length, t: fmtDateTime(samples[0].ts) })}</p>
            </>
          )}
        </>
      )}
    </AdminPage>
  );
}
