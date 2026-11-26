/**
 * The geometry of the background «a map of the land»: contour rings around three hills that slowly change their shape,
 * a wave of light that runs from a top outwards, and a mark for every server of the panel. Pure: no canvas, no DOM.
 */

export interface Hill { x: number; y: number; rings: number; shape: number; step: number }

/** the three hills in shares of the screen (they were drawn on a board of 1200 × 750) */
const PLACES: { fx: number; fy: number; rings: number; shape: number }[] = [
  { fx: 1150 / 1200, fy: 80 / 750, rings: 17, shape: 1.7 },
  { fx: 260 / 1200, fy: 720 / 750, rings: 16, shape: 4.2 },
  { fx: 760 / 1200, fy: 800 / 750, rings: 12, shape: 2.9 },
];

/** the hills of a screen: the rings grow with the screen, within limits, so a phone does not get a few giant ones */
export function hillsFor(width: number, height: number): Hill[] {
  const scale = Math.min(1.8, Math.max(0.7, Math.max(width / 1200, height / 750)));
  return PLACES.map((p) => ({ x: p.fx * width, y: p.fy * height, rings: p.rings, shape: p.shape, step: 27 * scale }));
}

/** the point of ring `k` of a hill at angle `a`; `t` (seconds) bends the rings slowly */
export function ringPoint(h: Hill, k: number, a: number, t: number): [number, number] {
  const r = k * h.step;
  const w = 1
    + 0.16 * Math.sin(a * 3 + h.shape + k * 0.22 + t * 0.35)
    + 0.09 * Math.sin(a * 5 - k * 0.31 + h.shape * 2 - t * 0.27)
    + 0.04 * Math.sin(a * 9 + k * 0.5 + t * 0.5);
  return [h.x + Math.cos(a) * r * w * 1.25, h.y + Math.sin(a) * r * w];
}

/** how bright ring `k` is while the wave of hill number `n` passes: 0 … 1 */
export function waveGlow(k: number, t: number, n: number, rings: number): number {
  const front = (t * 3.2 + n * 7) % (rings + 10);
  return Math.exp(-((k - front) ** 2) / 1.6);
}

export type MarkState = 'on' | 'off' | 'maint';
export interface MarkServer { id: number; online: boolean; hasStatus?: boolean; maintenance?: unknown }
export interface Mark { id: number; hill: number; ring: number; angle: number; state: MarkState }

type Spot = { hill: number; ring: number; angle: number; at: [number, number] };

/** the width of the column the pages sit in: a mark behind it would not be seen */
export const COLUMN = 1152;
export const MAX_MARKS = 24;

const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Where each server stands on the map. A server keeps its place between visits (it comes from its number); places beside
 * the column of the page are preferred, so the mark is seen. A server that was never asked is not shown.
 */
export function placeMarks(servers: MarkServer[], hills: Hill[], width: number, height: number): Mark[] {
  const side = (width - COLUMN) / 2;
  const free = (x: number, y: number) => y < 70 || y > height - 90 || (side > 24 ? x < side - 8 || x > width - side + 8 : false);
  const inside = (x: number, y: number) => x > 14 && x < width - 14 && y > 14 && y < height - 14;
  const taken: [number, number][] = [];
  const out: Mark[] = [];
  for (const s of servers.filter((x) => x.hasStatus !== false).slice(0, MAX_MARKS)) {
    let fallback: Spot | null = null;
    let found: Spot | null = null;
    for (let i = 0; i < 60 && !found; i++) {
      const seed = s.id * 61 + i;
      const hill = Math.floor(hash(seed) * hills.length);
      const ring = 2 + Math.floor(hash(seed + 0.37) * (hills[hill].rings - 4));
      const angle = hash(seed + 0.71) * Math.PI * 2;
      const at = ringPoint(hills[hill], ring, angle, 0);
      if (!inside(at[0], at[1]) || taken.some((p) => Math.hypot(p[0] - at[0], p[1] - at[1]) < 46)) continue;
      const c = { hill, ring, angle, at };
      fallback ??= c;
      if (free(at[0], at[1])) found = c;
    }
    const best = found ?? fallback;
    if (!best) continue;
    taken.push(best.at);
    out.push({ id: s.id, hill: best.hill, ring: best.ring, angle: best.angle, state: s.maintenance ? 'maint' : s.online ? 'on' : 'off' });
  }
  return out;
}

/** «214 66 10» (a colour token of the theme) → three numbers; the fallback for a token that cannot be read */
export function tokenRgb(raw: string, fallback: [number, number, number]): [number, number, number] {
  const m = /^\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(raw);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : fallback;
}

export const mix = (a: [number, number, number], b: [number, number, number], share: number): [number, number, number] =>
  [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * share)) as [number, number, number];

export const rgba = (c: [number, number, number], alpha: number): string => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
