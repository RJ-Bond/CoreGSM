import { useEffect, useRef } from 'react';
import { api, type Server } from '../api';
import { useAppearance } from '../appearance';
import { prefersReducedMotion } from '../useMotion';
import { hillsFor, mix, placeMarks, rgba, ringPoint, tokenRgb, waveGlow, type Hill, type Mark, type MarkServer } from './mapBackgroundLogic';

/** thirty frames a second are enough for slow lines */
const FRAME_MS = 32;
const SERVERS_MS = 60_000;

/** should the picture stand still: the person asked for less motion, or the traffic and the device are spared */
const still = () => prefersReducedMotion() || document.documentElement.dataset.lite === '1';

function colours() {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: [number, number, number]) => tokenRgb(css.getPropertyValue(name), fallback);
  const brand = read('--brand', [214, 66, 10]);
  const ink = read('--ink', [244, 243, 241]);
  const link = read('--link', brand);
  return { line: mix(ink, brand, 0.45), bold: brand, glow: link, on: read('--ok', [74, 222, 128]), off: read('--bad', [248, 113, 113]), maint: read('--warn', [251, 191, 36]) };
}

function paint(ctx: CanvasRenderingContext2D, hills: Hill[], marks: Mark[], palette: ReturnType<typeof colours>, t: number, moving: boolean, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  hills.forEach((h, n) => {
    for (let k = 1; k <= h.rings; k++) {
      ctx.beginPath();
      for (let i = 0; i <= 90; i++) {
        const [x, y] = ringPoint(h, k, (i / 90) * Math.PI * 2, t);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
      const main = k % 5 === 0;
      ctx.strokeStyle = main ? rgba(palette.bold, 0.42) : rgba(palette.line, 0.13);
      ctx.lineWidth = main ? 1.5 : 1;
      ctx.stroke();
      const glow = moving ? waveGlow(k, t, n, h.rings) : 0;
      if (glow > 0.03) {
        ctx.strokeStyle = rgba(palette.glow, glow * 0.6);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  });
  marks.forEach((m, i) => {
    const [x, y] = ringPoint(hills[m.hill], m.ring, m.angle, t);
    const c = palette[m.state];
    if (moving) {
      // a server that answers sends a calm ring; one that does not, a quicker one
      const phase = (t * (m.state === 'off' ? 0.9 : 0.45) + i * 0.37) % 1;
      ctx.beginPath();
      ctx.arc(x, y, 5 + phase * 22, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(c, (1 - phase) * 0.75);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = rgba(c, 0.95);
    ctx.fill();
  });
}

/**
 * The background of the panel: a map of the land behind the page. Decoration only (hidden from readers and clicks); the
 * marks are the servers: green answers, red does not, amber is in maintenance. Stands still with less motion or data saving.
 */
function MapCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx) return;
    let width = 0;
    let height = 0;
    let hills: Hill[] = [];
    let marks: Mark[] = [];
    let servers: MarkServer[] = [];
    let palette = colours();
    let frame = 0;
    let last = 0;
    let clock = 0;
    let off = false;

    const once = () => paint(ctx, hills, marks, palette, clock, !still(), width, height);
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const ratio = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      hills = hillsFor(width, height);
      marks = placeMarks(servers, hills, width, height);
      once();
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      clock += Math.min(0.1, (now - last) / 1000);
      last = now;
      once();
    };
    // the loop runs only while motion is wanted; a hidden tab gets no frames from the browser by itself
    const run = () => {
      cancelAnimationFrame(frame);
      if (still()) once();
      else frame = requestAnimationFrame(tick);
    };
    const restyle = () => { palette = colours(); run(); };
    const load = () => {
      if (document.hidden) return;
      api<Server[]>('/servers')
        .then((list) => {
          if (off || !Array.isArray(list)) return;
          servers = list;
          marks = placeMarks(servers, hills, width, height);
          once();
        })
        .catch(() => { /* a closed panel or no connection: the map stays without marks */ });
    };

    resize();
    run();
    load();
    const timer = window.setInterval(load, SERVERS_MS);
    const watch = new MutationObserver(restyle);
    watch.observe(document.documentElement, { attributes: true });
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', restyle);
    scheme?.addEventListener?.('change', restyle);
    window.addEventListener('resize', resize);
    return () => {
      off = true;
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
      watch.disconnect();
      media?.removeEventListener?.('change', restyle);
      scheme?.removeEventListener?.('change', restyle);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return <canvas ref={ref} className="map-bg" aria-hidden="true" data-testid="map-bg" />;
}

/** the map, unless it is switched off in the profile or the high contrast is on (lines behind text work against it) */
export default function MapBackground() {
  const [{ noMap, highContrast }] = useAppearance();
  return noMap || highContrast ? null : <MapCanvas />;
}
