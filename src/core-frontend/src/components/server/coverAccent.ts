/**
 * The accent of a server page taken from its cover: the picture is shrunk to 32x32 and the hue of its colourful
 * pixels (weighted by saturation and brightness, dark and washed-out ones ignored) becomes the colour of the
 * charts, bars and glows. The result is tuned to stay readable and cached per picture for the visit.
 */
import { useEffect, useState } from 'react';

const cache = new Map<string, string | null>();

function accentOf(img: HTMLImageElement): string | null {
  const N = 32;
  const cv = document.createElement('canvas');
  cv.width = N;
  cv.height = N;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, N, N);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, N, N).data;
  } catch {
    return null; // a picture from another origin taints the canvas
  }
  let sx = 0;
  let sy = 0;
  let sw = 0;
  let sat = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const d = mx - mn;
    if (data[i + 3] < 200 || mx < 0.18 || d < 0.12) continue;
    const s = d / mx;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    const a = (h * Math.PI) / 3;
    const w = s * s * mx;
    sx += Math.cos(a) * w;
    sy += Math.sin(a) * w;
    sw += w;
    sat += s * w;
  }
  if (sw < 2) return null; // grey or nearly black picture: keep the game's colour
  const hue = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  const s = Math.round(Math.min(78, Math.max(48, (sat / sw) * 100)));
  return `hsl(${Math.round(hue)} ${s}% 52%)`;
}

/** the cover's accent, or `fallback` until it is known (and for pictures without a clear colour) */
export function useCoverAccent(url: string | null | undefined, fallback: string): string {
  const [c, setC] = useState<string | null>(() => (url ? cache.get(url) ?? null : null));
  useEffect(() => {
    if (!url) { setC(null); return; }
    if (cache.has(url)) { setC(cache.get(url) ?? null); return; }
    let alive = true;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const v = accentOf(img);
      cache.set(url, v);
      if (alive) setC(v);
    };
    img.onerror = () => cache.set(url, null);
    img.src = url;
    return () => { alive = false; };
  }, [url]);
  return c ?? fallback;
}
