import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { NewsServerInfo } from '../gameNews';
import { t, useI18n } from '../i18n';
import { SmoothArea, usePoll } from '../ui';
import { EmptyState } from './GameNewsUi';

export interface MetricPoint { ts: number; fps: number; minFps: number; worstMs: number; freezes: number; memMb: number; heapMb: number; players: number }

const PERIODS = [6, 24, 168] as const;
type Hours = (typeof PERIODS)[number];
const KEY = 'coregsm_gn_metrics_hours';
const readHours = (): Hours => { try { const v = Number(localStorage.getItem(KEY)); return (PERIODS as readonly number[]).includes(v) ? (v as Hours) : 24; } catch { return 24; } };

const gb = (mb: number) => `${(mb / 1024).toFixed(2)} ${t('gn.mt.gb')}`;

/** one figure of the state: the last value, the lowest and the highest of the period, and the curve */
function Card({ title, values, last, fmt, color, hint }: { title: string; values: number[]; last: number; fmt: (n: number) => string; color: string; hint?: string }) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return (
    <div className="rounded-2xl bg-soft p-3.5" title={hint}>
      <div className="text-sm font-bold text-mute">{title}</div>
      <div className="mt-0.5 text-2xl font-black tabular-nums">{fmt(last)}</div>
      <SmoothArea values={values.length > 1 ? values : [...values, ...values]} color={color} className="mt-2 h-12" label={title} />
      <div className="mt-1 flex justify-between text-xs font-semibold tabular-nums text-mute"><span>{t('gn.mt.min')} {fmt(lo)}</span><span>{t('gn.mt.max')} {fmt(hi)}</span></div>
    </div>
  );
}

/**
 * The state of a game server from the plugin (0.18.11+): frames per second, memory, the longest frame and freezes.
 * Memory that grows through the day while the timeouts get more frequent points at the memory (a nightly restart helps);
 * fewer frames with the same players means the server does not keep up.
 */
export function MetricsSection() {
  useI18n();
  const [servers, setServers] = useState<NewsServerInfo[] | null>(null);
  const [server, setServer] = useState(0);
  const [hours, setHours] = useState<Hours>(readHours);
  const [points, setPoints] = useState<MetricPoint[] | null>(null);

  useEffect(() => {
    void api<{ servers: NewsServerInfo[] }>('/game-news').then((r) => {
      const list = r.servers.filter((s) => s.supported && s.hasToken);
      setServers(list);
      setServer((cur) => (cur && list.some((s) => s.id === cur) ? cur : list[0]?.id ?? 0));
    }).catch(() => setServers([]));
  }, []);

  const load = () => (server ? api<{ points: MetricPoint[] }>(`/game-news/metrics?server=${server}&hours=${hours}`).then((r) => setPoints(r.points)).catch(() => undefined) : Promise.resolve());
  usePoll(load, 60_000);
  // a new server or period: the points of the old one are not shown while the new ones come
  useEffect(() => {
    if (!server) return undefined;
    let off = false;
    setPoints(null);
    void api<{ points: MetricPoint[] }>(`/game-news/metrics?server=${server}&hours=${hours}`).then((r) => { if (!off) setPoints(r.points); }).catch(() => undefined);
    return () => { off = true; };
  }, [server, hours]);

  const pick = (h: Hours) => { setHours(h); try { localStorage.setItem(KEY, String(h)); } catch { /* not remembered */ } };
  const view = useMemo(() => {
    if (!points || points.length === 0) return null;
    return {
      last: points[points.length - 1]!,
      fps: points.map((p) => p.fps),
      mem: points.map((p) => p.memMb),
      worst: points.map((p) => p.worstMs / 1000),
      freezes: points.map((p) => p.freezes),
    };
  }, [points]);

  if (servers && servers.length === 0) return null;
  return (
    <section className="panel space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h3 className="font-extrabold">{t('gn.mt.title')}</h3>
          <p className="text-sm font-semibold text-mute">{t('gn.mt.note')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {servers && servers.length > 1 && (
            <select className="input w-52 py-1 text-sm" value={server} aria-label={t('gn.cn.server')} onChange={(e) => setServer(Number(e.target.value))}>
              {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <div className="seg" role="group" aria-label={t('gn.cn.period')}>
            {PERIODS.map((h) => <button key={h} type="button" className="seg-item" aria-pressed={hours === h} onClick={() => pick(h)}>{t(`gn.mt.p.${h}` as 'gn.mt.p.24')}</button>)}
          </div>
        </div>
      </div>
      {(servers == null || (server && points == null)) && <div className="skeleton h-28 rounded-xl" aria-busy="true" />}
      {points && !view && <EmptyState icon="📈" title={t('gn.mt.empty')} hint={t('gn.mt.emptyHint')} />}
      {view && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card title={t('gn.mt.fps')} values={view.fps} last={view.last.fps} fmt={(n) => n.toFixed(1)} color="rgb(var(--ok))" hint={t('gn.mt.fpsHint')} />
          <Card title={t('gn.mt.mem')} values={view.mem} last={view.last.memMb} fmt={(n) => gb(n)} color="rgb(var(--brand-2))" hint={t('gn.mt.memHint')} />
          <Card title={t('gn.mt.worst')} values={view.worst} last={view.last.worstMs / 1000} fmt={(n) => `${n.toFixed(2)} ${t('gn.mt.s')}`} color="rgb(var(--warn))" hint={t('gn.mt.worstHint')} />
          <Card title={t('gn.mt.freezes')} values={view.freezes} last={view.last.freezes} fmt={(n) => String(Math.round(n))} color="rgb(var(--bad))" hint={t('gn.mt.freezesHint')} />
        </div>
      )}
    </section>
  );
}
