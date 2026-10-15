/** Small charts: the 24 h sparkline, smooth area paths and the fleet status bar. */
import { useEffect, useId, useState } from 'react';
import { getToken } from '../api';

// history of a server is shared between remounts (list <-> details) for a couple of minutes
const sparkCache = new Map<number, { at: number; pts: number[] }>();
const SPARK_EVERY = 3 * 60_000;

/**
 * 24h player-count sparkline. Loads its own history, but cheaply: the first request is staggered, it refreshes every 3 minutes,
 * pauses while the tab is hidden and is aborted on unmount. A quiet placeholder is shown until there are two points.
 */
export function Spark({ serverId, color, variant = 'tile' }: { serverId: number; color: string; variant?: 'tile' | 'hero' }) {
  const [pts, setPts] = useState<number[]>(() => sparkCache.get(serverId)?.pts ?? []);

  useEffect(() => {
    let timer = 0;
    let ctl: AbortController | null = null;
    let alive = true;

    const load = async () => {
      if (!alive || document.hidden) return;
      ctl?.abort();
      ctl = new AbortController();
      try {
        const token = getToken();
        const res = await fetch(`/api/servers/${serverId}/history?hours=24`, {
          signal: ctl.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return;
        const rows = (await res.json()) as { players: number }[];
        // downsample to at most 48 points
        const step = Math.max(1, Math.ceil(rows.length / 48));
        const next = rows.filter((_, i) => i % step === 0).map((r) => r.players);
        sparkCache.set(serverId, { at: Date.now(), pts: next });
        if (alive) setPts(next);
      } catch {
        /* aborted or offline: keep what we have */
      }
    };
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await load();
        if (alive) schedule(SPARK_EVERY);
      }, delay);
    };

    const cached = sparkCache.get(serverId);
    const age = cached ? Date.now() - cached.at : Infinity;
    // spread the first requests of many cards over ~2.5 s so they do not arrive as one burst
    schedule(age < SPARK_EVERY ? SPARK_EVERY - age : variant === 'hero' ? 0 : 150 + Math.random() * 2500);

    const onVisible = () => {
      if (document.hidden) return;
      const c = sparkCache.get(serverId);
      if (!c || Date.now() - c.at >= SPARK_EVERY) schedule(100 + Math.random() * 1000);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      ctl?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [serverId, variant]);

  if (pts.length < 2) return <div className={`${variant === 'hero' ? 'h-[130px] bg-white/10' : 'h-10 bg-soft/60'} rounded-2xl`} aria-hidden />;
  const label = `Игроков за 24 часа: от ${Math.min(...pts)} до ${Math.max(...pts)}`;
  return variant === 'hero'
    ? <SmoothArea values={pts} color={color} w={560} h={130} grid fill={0.4} strokeWidth={2.6} className="h-[130px]" label={label} />
    : <SmoothArea values={pts} color={color} w={240} h={40} fill={0.25} strokeWidth={2} className="h-10" label={label} />;
}

/** Smooth curve through the points (cubic Bezier with horizontal tangents at the midpoints). */
export function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

/**
 * Smooth area chart of a player-count series: gradient fill, line, optional dashed grid and an end dot with a halo.
 * The drawing stretches (preserveAspectRatio none, non-scaling stroke); the dot is an HTML element so it stays round.
 */
export function SmoothArea({
  values, color, w = 240, h = 40, grid = false, dot = true, strokeWidth = 2, fill = 0.28, className = 'h-10', label, max: fixedMax,
}: {
  values: number[]; color: string; w?: number; h?: number; grid?: boolean; dot?: boolean; strokeWidth?: number; fill?: number;
  className?: string; label?: string; max?: number;
}) {
  const gid = useId();
  const pad = 3;
  const max = Math.max(1, fixedMax ?? 0, ...values) * 1.12;
  const pts: [number, number][] = values.map((v, i) => [pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2), h - pad - (v / max) * (h - pad * 2)]);
  const line = smoothPath(pts);
  const last = pts[pts.length - 1];
  return (
    <div className={`relative w-full ${className}`}>
      <svg viewBox={`0 0 ${w} ${h}`} className="chart-reveal absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={fill} />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid && [1, 2, 3].map((k) => (
          <line key={k} x1="0" x2={w} y1={(h / 4) * k} y2={(h / 4) * k} stroke={color} strokeOpacity=".22" strokeDasharray="3 6" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={`${line} L${last[0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {dot && (
        <span
          aria-hidden
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${(last[0] / w) * 100}%`, top: `${(last[1] / h) * 100}%`, background: color, boxShadow: `0 0 0 4px ${color}40` }}
        />
      )}
    </div>
  );
}

// ---------- fleet status: one segmented bar for online / lag / offline ----------
export function FleetBar({ online, lag, offline }: { online: number; lag: number; offline: number }) {
  const total = online + lag + offline;
  if (total === 0) return null;
  const seg = [
    { n: online, cls: 'bg-ok', label: 'онлайн' },
    { n: lag, cls: 'bg-warn', label: 'лагают' },
    { n: offline, cls: 'bg-bad', label: 'недоступны' },
  ].filter((x) => x.n > 0);
  return (
    <div className="panel px-5 py-4">
      <div className="flex h-2.5 gap-1 overflow-hidden rounded-full" role="img" aria-label={seg.map((x) => `${x.n} ${x.label}`).join(', ')}>
        {seg.map((x) => <div key={x.label} className={`${x.cls} rounded-full transition-all duration-500`} style={{ flex: x.n }} />)}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-sm font-bold text-mute">
        {seg.map((x) => (
          <span key={x.label} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${x.cls}`} />{x.n} {x.label}</span>
        ))}
      </div>
    </div>
  );
}
