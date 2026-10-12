// Colour helpers for the brand-colour safeguard (WCAG 2.1 contrast).
export type RGB = [number, number, number];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** "#4f46e5" / "#4af" -> [79, 70, 229]; null when it is not a hex colour */
export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

/** "23 24 29" (a CSS variable value) -> [23, 24, 29] */
export function parseTriplet(v: string): RGB | null {
  const p = v.trim().split(/\s+/).map(Number);
  return p.length === 3 && p.every((n) => Number.isFinite(n)) ? (p as RGB) : null;
}

const lin = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
export const luminance = (c: RGB) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);

export function contrast(a: RGB, b: RGB): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function toHsl([r, g, b]: RGB): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, s, l];
}

export function fromHsl([h, s, l]: [number, number, number]): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255)) as RGB;
}

/**
 * Moves the lightness of `c` (hue and saturation kept) in the given direction until it has `min` contrast
 * with every colour in `against`. Returns the original colour when it already passes.
 */
export function ensureContrast(c: RGB, against: RGB[], min: number, direction: 'darken' | 'lighten'): RGB {
  const ok = (x: RGB) => against.every((bg) => contrast(x, bg) >= min);
  if (ok(c)) return c;
  const [h, s, l] = toHsl(c);
  const step = direction === 'darken' ? -0.01 : 0.01;
  let cur = c;
  for (let L = l + step; L >= 0 && L <= 1; L += step) {
    cur = fromHsl([h, s, clamp(L, 0, 1)]);
    if (ok(cur)) return cur;
  }
  return cur;
}

export const mix = (a: RGB, b: RGB, k: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * k)) as RGB;
export const triplet = (c: RGB) => c.join(' ');
export const WHITE: RGB = [255, 255, 255];
export const BLACK: RGB = [0, 0, 0];
