/** Small charts: the 24 h sparkline, smooth area paths and the fleet status bar. */
import { useEffect, useId, useState } from 'react';
import { getToken } from '../api';

/**
 * The 24 h curves of all servers come in one request (/api/servers/sparks) shared by every sparkline on the page:
 * refreshed every 3 minutes while someone shows a sparkline and the tab is visible.
 */
interface SparkSet { at: number; servers: Record<number, { players: (number | null)[]; down: boolean[] }> }
const SPARK_EVERY = 3 * 60_000;
let sparkSet: SparkSet | null = null;
let sparkLoading: Promise<void> | null = null;
let sparkTimer = 0;
const sparkSubs = new Set<() => void>();

function loadSparks(): Promise<void> {
  if (sparkLoading) return sparkLoading;
  sparkLoading = (async () => {
    try {
      const token = getToken();
      const res = await fetch('/api/servers/sparks?hours=24', { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (res.ok) {
        const d = (await res.json()) as { servers: SparkSet['servers'] };
        sparkSet = { at: Date.now(), servers: d.servers ?? {} };
        sparkSubs.forEach((f) => f());
      }
    } catch {
      /* offline: keep what we have */
    } finally {
      sparkLoading = null;
    }
  })();
  return sparkLoading;
}

function scheduleSparks() {
  window.clearTimeout(sparkTimer);
  if (!sparkSubs.size) return;
  const age = sparkSet ? Date.now() - sparkSet.at : Infinity;
  sparkTimer = window.setTimeout(async () => {
    if (!document.hidden) await loadSparks();
    scheduleSparks();
  }, age >= SPARK_EVERY ? 0 : SPARK_EVERY - age);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden && sparkSubs.size) scheduleSparks(); });
}

function useSparkSet(): SparkSet | null {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    sparkSubs.add(f);
    scheduleSparks();
    return () => { sparkSubs.delete(f); if (!sparkSubs.size) window.clearTimeout(sparkTimer); };
  }, []);
  return sparkSet;
}

/** minutes of history behind the sparkline of a server (the 24 h window, or less on a young panel); null until loaded */
export function useSparkSpanMin(serverId: number): number | null {
  const set = useSparkSet();
  const raw = set?.servers[serverId];
  if (!set || !raw) return null;
  const first = raw.players.findIndex((v) => v != null);
  if (first < 0) return null;
  return Math.round(((raw.players.length - first) * 24 * 60) / raw.players.length);
}

/** «за 24 часа» / «за 3 ч» / «за 40 мин» for a span in minutes (null = the whole day while nothing is known) */
export const spanCaption = (min: number | null): string =>
  min == null || min >= 24 * 60 - 1 ? 'за 24 часа' : min >= 180 ? `за ${Math.round(min / 60)} ч` : `за ${Math.max(1, min)} мин`;

/** empty buckets (no poll yet, or the panel was off) take the value before them */
const filled = (vals: (number | null)[]): number[] => {
  let prev = vals.find((v) => v != null) ?? 0;
  return vals.map((v) => (v == null ? prev : (prev = v)));
};

/**
 * 24h player-count sparkline; the stretches when the server was down are tinted red. A quiet shimmering placeholder
 * is shown only until the shared request answers.
 */
export function Spark({ serverId, color, variant = 'tile' }: { serverId: number; color: string; variant?: 'tile' | 'hero' }) {
  const set = useSparkSet();
  const raw = set?.servers[serverId];
  const hero = variant === 'hero';
  if (!set) return <div className={`${hero ? 'h-[130px] bg-white/10' : 'h-10 bg-soft/60'} skeleton rounded-2xl`} aria-hidden />;
  // a young panel: the curve starts at the first bucket that has data instead of a long flat stretch before it
  const first = raw ? raw.players.findIndex((v) => v != null) : -1;
  const players = raw && first >= 0 ? raw.players.slice(first) : [];
  const downs24 = raw && first >= 0 ? raw.down.slice(first) : [];
  const known = players.filter((v) => v != null).length;
  if (!raw || known < 2) {
    return (
      <div className={`${hero ? 'h-[130px] border-white/30 text-white/80' : 'h-10 border-line text-mute'} grid place-items-center rounded-2xl border border-dashed px-2 text-center text-xs font-bold`}>
        История появится после нескольких опросов
      </div>
    );
  }
  const pts = filled(players);
  const downs = downs24.filter(Boolean).length;
  const label = `Игроков за 24 часа: от ${Math.min(...pts)} до ${Math.max(...pts)}${downs ? `; сервер был недоступен` : ''}`;
  return hero
    ? <SmoothArea values={pts} down={downs24} color={color} w={560} h={130} grid fill={0.4} strokeWidth={2.6} className="h-[130px]" label={label} />
    : <SmoothArea values={pts} down={downs24} color={color} w={240} h={40} fill={0.25} strokeWidth={2} className="h-10" label={label} />;
}

/**
 * The red «server was down» band of sample `i` of `n` in a chart `w` wide with `pad` on both sides: the part of the
 * x axis that sample stands for, never outside the chart (with few samples one band is wide, and the first and last
 * ones used to stick out of the chart).
 */
export function downBand(i: number, n: number, w: number, pad = 3): { x: number; width: number } {
  const step = (w - pad * 2) / Math.max(1, n - 1);
  const cx = pad + (n <= 1 ? 0 : (i / (n - 1)) * (w - pad * 2));
  const x0 = Math.max(0, cx - step / 2);
  const x1 = Math.min(w, cx + step / 2);
  return { x: x0, width: Math.max(0, x1 - x0) };
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
  values, color, w = 240, h = 40, grid = false, dot = true, strokeWidth = 2, fill = 0.28, className = 'h-10', label, max: fixedMax, down,
}: {
  values: number[]; color: string; w?: number; h?: number; grid?: boolean; dot?: boolean; strokeWidth?: number; fill?: number;
  className?: string; label?: string; max?: number;
  /** points at which the server was down: a red band behind the curve */
  down?: boolean[];
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
        {down?.map((d, i) => {
          if (!d || !pts[i]) return null;
          const b = downBand(i, values.length, w, pad);
          return <rect key={i} x={b.x} y={0} width={b.width} height={h} fill="rgb(var(--bad))" fillOpacity=".22" />;
        })}
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
