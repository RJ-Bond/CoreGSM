import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { ServerDetails } from '../../api';
import { t, useI18n } from '../../i18n';
import { fmtDateTime, smoothPath, toast } from '../../ui';
import { exportFileName, pingTone, TONE_TEXT } from './helpers';
import { findPeak, peakWhen } from './serverLogic';

type Point = ServerDetails['points'][number];
type Ev = ServerDetails['events'][number];
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

const MARK: Record<Ev['type'], { fill: string; path: string }> = {
  down: { fill: 'rgb(var(--bad))', path: 'M12 5v12M7 13l5 5 5-5' },
  up: { fill: 'rgb(var(--ok))', path: 'M5 12.5l4.5 4.5L19 7.5' },
  peak: { fill: 'rgb(var(--link))', path: 'M12 19V6M7 11l5-5 5 5' },
  maintenance: { fill: 'rgb(var(--warn))', path: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' },
};
const MARK_ORDER = ['down', 'up', 'peak', 'maintenance'] as const;
const MARK_LABEL: Record<Ev['type'], string> = { down: 'сбой', up: 'возврат', peak: 'пик', maintenance: 'тех. работы' };

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
  points, hours, max, color, series = 'players', loading = false, events = [], title = '', game = '',
}: { points: Point[]; hours: number; max: number; color: string; series?: Series; loading?: boolean; events?: Ev[]; title?: string; game?: string }) {
  useI18n();
  const L = 38, R = 10, B = 28;
  const [hover, setHover] = useState<number | null>(null);
  const [kbd, setKbd] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const gid = useId();
  // the drawing is 1:1 with the screen, so labels keep a readable size on phones
  const [W, setW] = useState(720);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setW(Math.max(280, Math.round(el.clientWidth)));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  const H = W < 520 ? 230 : 320;

  const now = Date.now();
  const winStart = now - hours * 3600_000;
  const first = points.length ? points[0].ts : now;
  const sparse = points.length < 20;
  // data may begin later than the window (new server, 30 days asked while 7 are kept)
  const late = points.length > 0 && first - winStart > hours * 3600_000 * 0.08;
  // with only a few samples the window shrinks to them instead of leaving a lonely tail on the right
  let t0 = winStart;
  if (sparse || late) t0 = Math.min(Math.max(winStart, first - (now - first) * 0.06), now - 15 * 60_000);
  const span = now - t0;
  // vertical markers for outages, returns and the busiest moment
  const marks = events.filter((e) => e.ts >= t0 && e.ts <= now).slice(0, 40);
  const T = marks.length ? 30 : 14;
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
  const peak = findPeak(points.filter((p) => p.ts >= t0), series);
  const longRange = hours > 36;
  const peakText = peak
    ? series === 'ping'
      ? t(longRange ? 'srv.chart.peakPingDate' : 'srv.chart.peakPing', { n: peak.value, time: peakWhen(peak.ts, hours) })
      : t(longRange ? 'srv.chart.peakDate' : 'srv.chart.peak', { n: peak.value, time: peakWhen(peak.ts, hours) })
    : '';
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

  /**
   * the chart as a PNG: computed styles are copied into a clone of the SVG, which is then drawn on a canvas.
   * The picture carries a caption band (server, game, period, dates, panel host, generation time in the user's zone)
   * and the legend, so it can be posted anywhere without explanation.
   */
  const exportPng = async () => {
    const el = svg.current;
    if (!el || saving) return;
    setSaving(true);
    try {
      const props = ['paint-order', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-weight', 'font-family', 'text-anchor', 'stop-color', 'stop-opacity'];
      const clone = el.cloneNode(true) as SVGSVGElement;
      const src = [el, ...Array.from(el.querySelectorAll('*'))];
      const dst = [clone, ...Array.from(clone.querySelectorAll('*'))] as SVGElement[];
      src.forEach((n, i) => {
        const cs = getComputedStyle(n);
        for (const p of props) dst[i].style.setProperty(p, cs.getPropertyValue(p));
      });
      const CAP = 76;
      const LEG = 32;
      const total = CAP + H + LEG;
      clone.removeAttribute('class');
      clone.removeAttribute('aria-hidden');
      clone.setAttribute('x', '0');
      clone.setAttribute('y', String(CAP));
      clone.setAttribute('width', String(W));
      clone.setAttribute('height', String(H));
      const bs = getComputedStyle(document.body);
      const bg = bs.backgroundColor && bs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? bs.backgroundColor : '#ffffff';
      const root = getComputedStyle(document.documentElement);
      const rgbVar = (name: string, fallback: string) => {
        const v = root.getPropertyValue(name).trim();
        return /^\d+\s+\d+\s+\d+$/.test(v) ? `rgb(${v.split(/\s+/).join(',')})` : fallback;
      };
      // the curve colour may be written with a CSS variable: resolve it for the standalone picture
      const probe = document.createElement('span');
      probe.style.color = color;
      document.body.appendChild(probe);
      const curve = getComputedStyle(probe).color || '#4f46e5';
      probe.remove();
      const mute = rgbVar('--mute', '#5c6372');
      const line = rgbVar('--line', '#e7e9f0');
      const bad = rgbVar('--bad', '#b92828');
      const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
      const fit = (t: string, px: number, max: number) => {
        const n = Math.max(8, Math.floor(max / (px * 0.58)));
        return t.length > n ? `${t.slice(0, n - 1)}…` : t;
      };
      const font = esc(bs.fontFamily);
      const periodName = hours <= 24 ? '24 часа' : hours <= 168 ? '7 дней' : '30 дней';
      const stamp = Date.now();
      const range = `${fmtDateTime(stamp - hours * 3600_000)} - ${fmtDateTime(stamp)}`;
      const head = title || 'Сервер';
      const sub1 = `${game ? `${game} · ` : ''}${seriesName} · ${periodName} · ${range}`;
      const sub2 = `CoreGSM · ${window.location.host} · создано ${fmtDateTime(stamp)}`;
      // legend: the curve, the outage band and the markers that are on the chart
      const items: { kind: 'curve' | 'band' | 'dot'; label: string; fill?: string }[] = [
        { kind: 'curve', label: seriesName },
        ...(points.some((p) => !p.online) ? [{ kind: 'band' as const, label: 'сервер не отвечал' }] : []),
        ...MARK_ORDER.filter((t) => marks.some((m) => m.type === t)).map((t) => ({ kind: 'dot' as const, label: MARK_LABEL[t], fill: MARK[t].fill })),
      ];
      let lx = 12;
      const ly = CAP + H + 20;
      let legend = '';
      for (const it of items) {
        if (it.kind === 'curve') legend += `<rect x="${lx}" y="${ly - 4}" width="18" height="4" rx="2" fill="${curve}"/>`;
        else if (it.kind === 'band') legend += `<rect x="${lx}" y="${ly - 9}" width="18" height="12" rx="3" fill="${bad}" fill-opacity="0.25"/>`;
        else legend += `<circle cx="${lx + 7}" cy="${ly - 3}" r="6" fill="${it.fill}"/>`;
        const tx0 = lx + 24;
        legend += `<text x="${tx0}" y="${ly}" fill="${mute}" font-family="${font}" font-size="12" font-weight="700">${esc(it.label)}</text>`;
        lx = tx0 + it.label.length * 7 + 18;
      }
      const out =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${total}" viewBox="0 0 ${W} ${total}">` +
        `<rect width="100%" height="100%" fill="${bg}"/>` +
        `<text x="12" y="27" fill="${bs.color}" font-family="${font}" font-size="17" font-weight="800">${esc(fit(head, 17, W - 24))}</text>` +
        `<text x="12" y="47" fill="${mute}" font-family="${font}" font-size="12.5" font-weight="700">${esc(fit(sub1, 12.5, W - 24))}</text>` +
        `<text x="12" y="65" fill="${mute}" font-family="${font}" font-size="11.5" font-weight="600">${esc(fit(sub2, 11.5, W - 24))}</text>` +
        `<line x1="12" x2="${W - 12}" y1="${CAP - 2}" y2="${CAP - 2}" stroke="${line}" stroke-width="1"/>` +
        new XMLSerializer().serializeToString(clone) +
        legend +
        `</svg>`;
      const url = URL.createObjectURL(new Blob([out], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new Image();
      await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('img')); img.src = url; });
      const k = 2;
      const cv = document.createElement('canvas');
      cv.width = W * k;
      cv.height = total * k;
      const ctx = cv.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.scale(k, k);
      ctx.drawImage(img, 0, 0, W, total);
      URL.revokeObjectURL(url);
      const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/png'));
      if (!blob) throw new Error('blob');
      const a = document.createElement('a');
      const dl = URL.createObjectURL(blob);
      a.href = dl;
      a.download = exportFileName(title, hours, stamp);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(dl), 4000);
    } catch {
      toast('Не удалось сохранить картинку', 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`transition-opacity duration-300 ${loading ? 'opacity-60' : ''}`}>
      {(sparse || late) && points.length > 0 && (
        <p className="mb-2 flex items-center gap-2 rounded-xl bg-soft px-3 py-1.5 text-sm font-bold text-mute">
          <span aria-hidden className="live-dot !bg-warn" />
          {late && hours > 168 ? `История есть с ${fmtDateTime(first)}: измерения хранятся 7 дней` : `Данные накапливаются с ${fmtDateTime(first)}`}
        </p>
      )}
      <div className="hc-head">
        <span className="hc-cap">{series === 'ping' ? t('srv.chart.axisPing') : t('srv.chart.axisPlayers')}</span>
        <span className="hc-notes">
          {peakText && <span className="hc-note">{peakText}</span>}
          {endPt && (
            <span className="hc-now" style={{ ['--hc' as string]: color }}>
              <i aria-hidden />
              {t('srv.chart.now', { n: `${endPt.v}${unit ? ` ${unit}` : ''}` })}
            </span>
          )}
        </span>
      </div>
      <div
        ref={wrap}
        className="hc-wrap relative rounded-2xl"
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
          className="hc-fade block h-auto w-full touch-pan-y select-none"
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
          {peak && peak.ts >= t0 && (
            <circle cx={x(peak.ts)} cy={y(peak.value)} r="7" fill="none" style={{ stroke: color }} strokeWidth="2" opacity="0.9" />
          )}
          {endPt && !hp && (
            <>
              <circle cx={x(endPt.ts)} cy={y(endPt.v)} r="9" style={{ fill: color }} opacity="0.22" />
              <circle cx={x(endPt.ts)} cy={y(endPt.v)} r="5.5" style={{ fill: color }} className="stroke-card" strokeWidth="2.5" />
              <text
                x={Math.min(W - R, Math.max(L + 16, x(endPt.ts) + 4))}
                y={y(endPt.v) - 14 < T + 10 ? y(endPt.v) + 24 : y(endPt.v) - 14}
                textAnchor="end"
                className="fill-ink stroke-card"
                fontSize="14"
                fontWeight="800"
                strokeWidth="4"
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                {endPt.v}{unit ? ` ${unit}` : ''}
              </text>
            </>
          )}
          {marks.map((m) => {
            const mx = Math.min(W - R - 9, Math.max(L + 9, x(m.ts)));
            const kind = MARK[m.type];
            const label = m.type === 'peak' ? `Пик игроков: ${m.players ?? '–'}` : m.type === 'up' ? 'Сервер вернулся' : m.type === 'maintenance' ? 'Начались технические работы' : 'Сервер упал';
            return (
              <g key={`${m.type}-${m.ts}`}>
                <title>{`${label} · ${fullTime(m.ts)}`}</title>
                <line x1={x(m.ts)} x2={x(m.ts)} y1={20} y2={H - B} className="stroke-mute" strokeWidth="1" strokeDasharray="2 4" opacity="0.5" />
                <circle cx={mx} cy={11} r="9" style={{ fill: kind.fill }} />
                <svg x={mx - 6} y={5} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d={kind.path} /></svg>
              </g>
            );
          })}
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
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <p className="text-xs font-bold text-mute">
        {t('srv.chart.axisX', { period: hours <= 24 ? t('srv.chart.p24') : hours <= 168 ? t('srv.chart.p7') : t('srv.chart.p30') })}
        {hp && hv != null && series === 'ping' && (
          <span className={`ml-2 ${TONE_TEXT[pingTone(hv).tone]}`}>{pingTone(hv).label}</span>
        )}
      </p>
      <button type="button" className="btn btn-soft btn-sm" onClick={() => void exportPng()} disabled={saving || points.length === 0} title="Сохранить график как картинку PNG">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></svg>
        {saving ? 'Готовим…' : 'Скачать PNG'}
      </button>
      </div>
      {marks.length > 0 && (
        <ul className="hc-legend" aria-label="Обозначения на графике">
          {MARK_ORDER.filter((t) => marks.some((m) => m.type === t)).map((t) => (
            <li key={t}>
              <span className="hc-dot" style={{ background: MARK[t].fill }} aria-hidden>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d={MARK[t].path} /></svg>
              </span>
              {MARK_LABEL[t]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
