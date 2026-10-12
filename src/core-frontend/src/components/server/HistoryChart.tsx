import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { ServerDetails } from '../../api';
import { fmtDateTime, plural, smoothPath } from '../../ui';
import { pingTone, TONE_TEXT } from './helpers';

type Point = ServerDetails['points'][number];
export type Series = 'players' | 'ping';

/** 0..yMax with about four steps of a "nice" size (1, 2, 5 x 10^n); the scale follows the data, not the server slots */
function niceScale(dataMax: number, minTop: number): { max: number; step: number; ticks: number[] } {
  const top = Math.max(dataMax * 1.2, minTop);
  const raw = top / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
  const max = Math.ceil(top / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return { max, step, ticks };
}

const tickLabel = (ts: number, spanMs: number) =>
  spanMs <= 36 * 3600_000
    ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

const fullTime = (ts: number) =>
  new Date(ts).toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Players (or ping) over time: smooth area, red bands where the server did not answer, a cursor with a tooltip
 * that follows the mouse / finger / pen and the arrow keys, Y axis that fits the data.
 */
export default function HistoryChart({
  points, hours, max, color, series = 'players', loading = false,
}: { points: Point[]; hours: number; max: number; color: string; series?: Series; loading?: boolean }) {
  const L = 38, R = 10, T = 14, B = 28;
  const [hover, setHover] = useState<number | null>(null);
  const [kbd, setKbd] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const gid = useId();
  // the drawing is 1:1 with the screen, so labels keep a readable size on phones
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setW(Math.max(280, Math.round(el.clientWidth)));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  const H = W < 520 ? 210 : 260;

  const now = Date.now();
  const winStart = now - hours * 3600_000;
  const first = points.length ? points[0].ts : now;
  const sparse = points.length < 20;
  // with only a few samples the window shrinks to them instead of leaving a lonely tail on the right
  let t0 = winStart;
  if (sparse) t0 = Math.min(Math.max(winStart, first - (now - first) * 0.06), now - 15 * 60_000);
  const span = now - t0;
  const x = (ts: number) => L + ((ts - t0) / span) * (W - L - R);

  const valueOf = (p: Point): number | null => {
    if (!p.online) return null;
    return series === 'ping' ? p.ping : p.players;
  };
  const vals = points.map(valueOf).filter((v): v is number => v != null);
  const dataMax = Math.max(0, ...vals);
  const scale = niceScale(dataMax, series === 'ping' ? 20 : 2);
  const yMax = scale.max;
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);

  // continuous runs of answered samples are separate curves; a gap is much wider than the usual spacing
  const bucket = (hours * 3600_000) / 180;
  const spacing = points.length > 1 ? [...points.slice(1).map((p, i) => p.ts - points[i].ts)].sort((a, b) => a - b)[Math.floor((points.length - 1) / 2)] : bucket;
  const gap = Math.max(bucket * 2.5, spacing * 2.5);
  const segments: { ts: number; v: number }[][] = [];
  let cur: { ts: number; v: number }[] = [];
  for (const p of points) {
    const v = valueOf(p);
    if (v != null) {
      if (cur.length && p.ts - cur[cur.length - 1].ts > gap) { segments.push(cur); cur = []; }
      cur.push({ ts: p.ts, v });
    } else if (cur.length) { segments.push(cur); cur = []; }
  }
  if (cur.length) segments.push(cur);

  const nearest = (clientX: number): number | null => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || points.length === 0 || r.width === 0) return null;
    const vx = ((clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p.ts) - vx) < Math.abs(x(points[best].ts) - vx)) best = i; });
    return best;
  };
  const onPointer = (e: ReactPointerEvent) => {
    setKbd(false);
    const i = nearest(e.clientX);
    if (i != null) setHover(i);
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if (points.length === 0) return;
    const last = points.length - 1;
    const at = hover == null ? last : Math.min(hover, last);
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = Math.max(0, at - 1);
    else if (e.key === 'ArrowRight') next = Math.min(last, at + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else if (e.key === 'Escape') { setHover(null); setKbd(false); return; }
    if (next == null) return;
    e.preventDefault();
    setKbd(true);
    setHover(next);
  };

  const hp = hover != null ? points[Math.min(hover, points.length - 1)] ?? null : null;
  const hv = hp ? valueOf(hp) : null;
  const lastSeg = segments[segments.length - 1];
  const endPt = lastSeg && now - lastSeg[lastSeg.length - 1].ts < gap ? lastSeg[lastSeg.length - 1] : null;
  const unit = series === 'ping' ? 'мс' : '';
  const capLine = series === 'players' && max > 0 && max <= yMax;

  const describe = (p: Point) => {
    if (!p.online) return `${fullTime(p.ts)}: сервер не отвечал`;
    const parts = [fullTime(p.ts), `игроков ${p.players}${max ? ` из ${max}` : ''}`];
    if (p.ping != null) parts.push(`пинг ${p.ping} мс`);
    return parts.join(', ');
  };
  const summary = vals.length
    ? `График ${series === 'ping' ? 'пинга' : 'игроков'} за ${hours <= 24 ? 'сутки' : 'неделю'}: от ${Math.min(...vals)} до ${Math.max(...vals)}${series === 'ping' ? ' мс' : ''}. Стрелки влево и вправо перемещают курсор.`
    : 'График пока пуст.';

  // tooltip: keep it inside the chart
  const TW = 188;
  const tx = hp ? Math.min(W - TW / 2 - 2, Math.max(TW / 2 + 2, x(hp.ts))) : 0;
  const seriesName = series === 'ping' ? 'Пинг' : 'Игроки';

  return (
    <div className={`transition-opacity duration-300 ${loading ? 'opacity-60' : ''}`}>
      {sparse && points.length > 0 && (
        <p className="mb-2 flex items-center gap-2 rounded-xl bg-soft px-3 py-1.5 text-sm font-bold text-mute">
          <span aria-hidden className="live-dot !bg-warn" />
          Данные накапливаются с {fmtDateTime(first)}
        </p>
      )}
      <div
        ref={wrap}
        className="relative rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        role="group"
        aria-label={summary}
        tabIndex={0}
        onKeyDown={onKey}
        onFocus={() => { if (hover == null && points.length) { setKbd(true); setHover(points.length - 1); } }}
        onBlur={() => { setHover(null); setKbd(false); }}
      >
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className="chart-reveal block h-auto w-full touch-pan-y select-none"
          aria-hidden
          onPointerDown={onPointer}
          onPointerMove={onPointer}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }}
          onPointerCancel={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: color }} stopOpacity="0.34" />
              <stop offset="1" style={{ stopColor: color }} stopOpacity="0" />
            </linearGradient>
          </defs>
          {scale.ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth="1" strokeDasharray={v === 0 ? undefined : '3 5'} />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" className="fill-mute" fontSize="12" fontWeight="700">{v}</text>
            </g>
          ))}
          {[0, 1, 2, 3, 4].map((i) => {
            const ts = t0 + (span * i) / 4;
            return <text key={i} x={x(ts)} y={H - 8} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} className="fill-mute" fontSize="12" fontWeight="700">{tickLabel(ts, span)}</text>;
          })}
          {capLine && <line x1={L} x2={W - R} y1={y(max)} y2={y(max)} className="stroke-mute" strokeDasharray="4 4" strokeWidth="1" opacity="0.5" />}
          {points.filter((p) => !p.online && p.ts >= t0).map((p) => {
            const bw = Math.max(3, ((W - L - R) * bucket) / span);
            return <rect key={p.ts} x={Math.max(L, x(p.ts) - bw / 2)} y={T} width={bw} height={H - T - B} className="fill-bad" opacity="0.2" />;
          })}
          {segments.map((seg, i) => {
            const pts = seg.map((p): [number, number] => [x(p.ts), y(p.v)]);
            const d = smoothPath(pts);
            return (
              <g key={i}>
                {seg.length === 1 && <circle cx={pts[0][0]} cy={pts[0][1]} r="3.5" style={{ fill: color }} />}
                {seg.length > 1 && <path d={`${d} L${pts[pts.length - 1][0].toFixed(1)},${y(0)} L${pts[0][0].toFixed(1)},${y(0)} Z`} fill={`url(#${gid})`} />}
                {seg.length > 1 && <path d={d} fill="none" style={{ stroke: color }} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />}
              </g>
            );
          })}
          {endPt && !hp && (
            <>
              <circle cx={x(endPt.ts)} cy={y(endPt.v)} r="9" style={{ fill: color }} opacity="0.22" />
              <circle cx={x(endPt.ts)} cy={y(endPt.v)} r="4.5" style={{ fill: color }} className="stroke-card" strokeWidth="2" />
            </>
          )}
          {hp && <line x1={x(hp.ts)} x2={x(hp.ts)} y1={T} y2={H - B} className="stroke-mute" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.7" />}
          {hp && hv != null && <circle cx={x(hp.ts)} cy={y(hv)} r="5.5" style={{ fill: color }} className="stroke-card" strokeWidth="2.5" />}
          {hp && hv == null && <circle cx={x(hp.ts)} cy={y(0)} r="4.5" className="fill-bad stroke-card" strokeWidth="2" />}
        </svg>
        {hp && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-xl bg-ink px-3 py-2 text-[13px] font-bold leading-snug text-page shadow-pop"
            style={{ left: tx, width: TW }}
          >
            <div className="whitespace-nowrap text-[12px] font-semibold opacity-80">{fullTime(hp.ts)}</div>
            {hp.online ? (
              <>
                <div className="whitespace-nowrap">
                  <span className="opacity-80">Игроки </span>
                  <span className="text-[15px] font-extrabold">{hp.players}</span>
                  {max > 0 && <span className="opacity-80"> / {max}</span>}
                </div>
                <div className="whitespace-nowrap">
                  <span className="opacity-80">Пинг </span>
                  {hp.ping != null ? <span className="text-[15px] font-extrabold">{hp.ping} мс</span> : <span className="opacity-70">нет данных</span>}
                </div>
              </>
            ) : (
              <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[#fca5a5]">
                <span className="h-2 w-2 rounded-full bg-[#f87171]" />
                сервер не отвечал
              </div>
            )}
          </div>
        )}
        <span className="sr-only" aria-live="polite">{kbd && hp ? describe(hp) : ''}</span>
      </div>
      <p className="mt-1 text-xs font-bold text-mute">
        {seriesName}{unit ? `, ${unit}` : ''}
        {hp && hv != null && series === 'ping' && (
          <span className={`ml-2 ${TONE_TEXT[pingTone(hv).tone]}`}>{pingTone(hv).label}</span>
        )}
        {series === 'players' && points.length > 0 && (
          <span className="ml-2 font-semibold">максимум за период: {Math.max(...points.map((p) => p.players))} {plural(Math.max(...points.map((p) => p.players)), ['игрок', 'игрока', 'игроков'])}</span>
        )}
      </p>
    </div>
  );
}
