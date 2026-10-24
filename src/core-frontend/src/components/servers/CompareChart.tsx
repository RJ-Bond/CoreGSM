/**
 * All servers on one chart: players (or the share of slots taken) over a day or a week, a line per server in its
 * game's colour, a cursor that lists every server at that moment, legend chips that hide a line, and a ranking:
 * average, peak and the change against the period before.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Server } from '../../api';
import { getToken } from '../../api';
import { gameColor } from '../../games';
import { GameAvatar, smoothPath } from '../../ui';

interface Sparks { hours: number; points: number; from: number; to: number; servers: Record<number, { players: (number | null)[]; down: boolean[] }> }

// distinct colours when two servers run the same game
const SPARE = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#65a30d', '#c026d3', '#0d9488'];

const PERIODS: [number, string][] = [[24, 'Сутки'], [168, 'Неделя']];

/** distance between the hues of two '#rrggbb' colours, in degrees */
function hueGap(a: string, b: string): number {
  const hue = (hex: string) => {
    const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
    if (Number.isNaN(n)) return 0;
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, bl = (n & 255) / 255;
    const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn;
    if (!d) return 0;
    const h = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
}

export default function CompareChart({ servers }: { servers: Server[] }) {
  const [hours, setHours] = useState(24);
  const [pct, setPct] = useState(false);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [data, setData] = useState<Sparks | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(900);
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(300, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // twice the period: the first half is the period before, for the change in the ranking
  useEffect(() => {
    let alive = true;
    const token = getToken();
    const points = hours <= 24 ? 96 : 168;
    fetch(`/api/servers/sparks?hours=${hours * 2}&points=${points}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      .then((r) => (r.ok ? (r.json() as Promise<Sparks>) : null))
      .then((d) => { if (alive && d) setData(d); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [hours]);

  // a line keeps its game's colour unless that hue is already taken by a line before it
  const colors = useMemo(() => {
    const used: string[] = [];
    let spare = 0;
    return new Map(servers.map((s) => {
      let c = gameColor(s.game);
      for (let k = 0; used.some((u) => hueGap(u, c) < 28) && k < SPARE.length; k++) c = SPARE[spare++ % SPARE.length];
      used.push(c);
      return [s.id, c];
    }));
  }, [servers]);

  const series = useMemo(() => {
    if (!data) return [];
    const half = Math.floor(data.points / 2);
    return servers.map((s) => {
      const raw = data.servers[s.id]?.players ?? [];
      const prevRaw = raw.slice(0, half);
      const curRaw = raw.slice(half);
      const known = (xs: (number | null)[]) => xs.filter((v): v is number => v != null);
      const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
      const cur = known(curRaw);
      const a = avg(cur);
      const p = avg(known(prevRaw));
      const scale = (v: number | null) => (v == null ? null : pct ? (s.maxPlayers > 0 ? Math.min(100, (v / s.maxPlayers) * 100) : null) : v);
      return {
        s,
        color: colors.get(s.id)!,
        values: curRaw.map(scale),
        avg: a,
        peak: cur.length ? Math.max(...cur) : null,
        change: a != null && p != null && p > 0 ? Math.round(((a - p) / p) * 100) : null,
      };
    });
  }, [data, servers, pct, colors]);

  const shown = series.filter((x) => !hidden.has(x.s.id));
  const n = shown[0]?.values.length ?? 0;
  const L = 40;
  const R = 12;
  const T = 12;
  const B = 26;
  const H = W < 520 ? 240 : 320;
  const top = pct ? 100 : Math.max(1, ...shown.flatMap((x) => x.values.filter((v): v is number => v != null)));
  const step = top <= 5 ? 1 : top <= 10 ? 2 : top <= 50 ? 10 : top <= 100 ? 20 : 50;
  const yMax = pct ? 100 : Math.ceil((top * 1.1) / step) * step;
  const x = (i: number) => L + (i / Math.max(1, n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const from = data ? data.to - hours * 3600_000 : Date.now() - hours * 3600_000;
  const tsOf = (i: number) => from + (i / Math.max(1, n - 1)) * hours * 3600_000;
  const label = (ts: number) => (hours <= 24 ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : new Date(ts).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' }));

  const onMove = (e: ReactPointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || !n) return;
    const vx = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.min(n - 1, Math.max(0, Math.round(((vx - L) / (W - L - R)) * (n - 1)))));
  };
  const toggle = (id: number) => setHidden((h) => { const next = new Set(h); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const ranked = [...series].sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
  const fmt = (v: number | null) => (v == null ? '–' : pct ? `${Math.round(v)}%` : String(Math.round(v * 10) / 10).replace('.', ','));

  return (
    <section className="tile tile-in p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold">Сравнение серверов</h2>
        <div className="flex flex-wrap gap-2">
          <div className="seg" role="group" aria-label="Что показывать">
            <button type="button" className="seg-item" aria-pressed={!pct} onClick={() => setPct(false)}>Игроки</button>
            <button type="button" className="seg-item" aria-pressed={pct} onClick={() => setPct(true)}>% мест</button>
          </div>
          <div className="seg" role="group" aria-label="Период">
            {PERIODS.map(([h, l]) => <button key={h} type="button" className="seg-item" aria-pressed={hours === h} onClick={() => setHours(h)}>{l}</button>)}
          </div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2" aria-label="Показать или скрыть сервер">
        {series.map((x) => (
          <button key={x.s.id} type="button" className="cmp-chip" aria-pressed={!hidden.has(x.s.id)} onClick={() => toggle(x.s.id)} style={{ ['--c' as string]: x.color }}>
            <i aria-hidden />{x.s.name}
          </button>
        ))}
      </div>

      <div ref={wrap} className="relative">
        {!data ? (
          <div className="skeleton rounded-2xl bg-soft" style={{ height: H }} aria-label="Загрузка" role="status" />
        ) : (
          <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full touch-pan-y select-none" role="img" aria-label={`Игроки на серверах за ${hours <= 24 ? 'сутки' : 'неделю'}`} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
            {Array.from({ length: Math.floor(yMax / (pct ? 25 : step)) + 1 }, (_, i) => i * (pct ? 25 : step)).map((v) => (
              <g key={v}>
                <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-line" strokeDasharray={v ? '3 5' : undefined} />
                <text x={L - 8} y={y(v) + 4} textAnchor="end" className="fill-mute" fontSize="12" fontWeight="700">{pct ? `${v}%` : v}</text>
              </g>
            ))}
            {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
              <text key={f} x={L + f * (W - L - R)} y={H - 8} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} className="fill-mute" fontSize="12" fontWeight="700">{label(from + f * hours * 3600_000)}</text>
            ))}
            {shown.map((x) => {
              const runs: [number, number][][] = [];
              let run: [number, number][] = [];
              x.values.forEach((v, i) => { if (v == null) { if (run.length) runs.push(run); run = []; } else run.push([L + (i / Math.max(1, n - 1)) * (W - L - R), y(v)]); });
              if (run.length) runs.push(run);
              return runs.map((r, k) => <path key={`${x.s.id}-${k}`} d={smoothPath(r)} fill="none" stroke={x.color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" opacity={hover == null ? 0.95 : 0.85} />);
            })}
            {hover != null && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="stroke-mute" strokeDasharray="3 3" />
                {shown.map((s) => s.values[hover] != null && <circle key={s.s.id} cx={x(hover)} cy={y(s.values[hover]!)} r="4.5" fill={s.color} className="stroke-card" strokeWidth="2" />)}
              </>
            )}
          </svg>
        )}
        {hover != null && data && (
          <div className="pointer-events-none absolute top-1 z-10 min-w-44 -translate-x-1/2 rounded-xl bg-ink px-3 py-2 text-[13px] font-bold text-page shadow-pop" style={{ left: Math.min(W - 100, Math.max(100, x(hover))) }}>
            <div className="mb-1 text-[12px] font-semibold opacity-80">{new Date(tsOf(hover)).toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
            {[...shown].sort((a, b) => (b.values[hover] ?? -1) - (a.values[hover] ?? -1)).map((s) => (
              <div key={s.s.id} className="flex items-center gap-2 whitespace-nowrap">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                <span className="max-w-40 truncate opacity-90">{s.s.name}</span>
                <span className="ml-auto font-extrabold">{s.values[hover] == null ? '—' : fmt(s.values[hover])}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="cmp-rank">
          <thead>
            <tr><th scope="col">#</th><th scope="col">Сервер</th><th scope="col">В среднем</th><th scope="col">Пик</th><th scope="col">К прошлому периоду</th></tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => (
              <tr key={r.s.id}>
                <td className="font-extrabold text-mute">{i + 1}</td>
                <td>
                  <a href={`/servers/${r.s.id}`} className="flex items-center gap-2 font-extrabold hover:text-link">
                    <GameAvatar game={r.s.game} size={26} />
                    <span className="truncate">{r.s.name}</span>
                  </a>
                </td>
                <td className="tabular-nums">{fmt(r.avg)}</td>
                <td className="tabular-nums">{fmt(r.peak)}</td>
                <td>{r.change == null ? <span className="text-mute">–</span> : <span className={`cmp-change ${r.change > 0 ? 'is-up' : r.change < 0 ? 'is-down' : ''}`}>{r.change > 0 ? '▲' : r.change < 0 ? '▼' : '•'} {Math.abs(r.change)}%</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
