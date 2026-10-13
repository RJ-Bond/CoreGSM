import type { CSSProperties } from 'react';
import type { TKey } from '../../i18n';

/** gradient presets of the profile banner (ids are fixed by the API) */
export const BANNER_PRESETS: { id: string; label: TKey; css: string }[] = [
  { id: 'aurora', label: 'pf.preset.aurora', css: 'linear-gradient(120deg, #0f766e 0%, #6366f1 55%, #a855f7 100%)' },
  { id: 'sunset', label: 'pf.preset.sunset', css: 'linear-gradient(120deg, #f97316 0%, #ec4899 55%, #7c3aed 100%)' },
  { id: 'forest', label: 'pf.preset.forest', css: 'linear-gradient(120deg, #14532d 0%, #16a34a 55%, #84cc16 100%)' },
  { id: 'ocean', label: 'pf.preset.ocean', css: 'linear-gradient(120deg, #0c4a6e 0%, #0284c7 55%, #22d3ee 100%)' },
  { id: 'vrising', label: 'pf.preset.vrising', css: 'linear-gradient(120deg, #1e0a3c 0%, #5b21b6 50%, #be185d 100%)' },
  { id: 'icarus', label: 'pf.preset.icarus', css: 'linear-gradient(120deg, #713f12 0%, #ca8a04 50%, #fde047 100%)' },
  { id: 'graphite', label: 'pf.preset.graphite', css: 'linear-gradient(120deg, #18181b 0%, #3f3f46 55%, #71717a 100%)' },
];

/** no image and no preset: the brand colour of the panel */
export const DEFAULT_BANNER = 'linear-gradient(120deg, rgb(var(--brand)) 0%, rgb(var(--brand-2)) 100%)';

/** inline style of a banner element: the uploaded image wins over the preset, the preset over the default */
export function bannerStyle(url: string | null | undefined, preset: string | null | undefined): CSSProperties {
  if (url) return { backgroundImage: `url(${JSON.stringify(url)})` };
  const p = BANNER_PRESETS.find((x) => x.id === preset);
  return { backgroundImage: p ? p.css : DEFAULT_BANNER };
}
