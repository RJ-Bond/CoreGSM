import { describe, expect, it } from 'vitest';
import { calmSeriesColor, hueOf } from './coverAccent';

describe('chart colour', () => {
  it('reads the hue of hsl and hex colours', () => {
    expect(hueOf('hsl(210 60% 52%)')).toBe(210);
    expect(Math.round(hueOf('#ff0000') ?? -1)).toBe(0);
    expect(Math.round(hueOf('#00ff00') ?? -1)).toBe(120);
    expect(hueOf('#888888')).toBeNull();
    expect(hueOf('rgb(var(--link))')).toBeNull();
  });
  it('replaces red with the calm colour and keeps the others', () => {
    expect(calmSeriesColor('hsl(2 70% 52%)')).toBe('rgb(var(--link))');
    expect(calmSeriesColor('hsl(352 70% 52%)')).toBe('rgb(var(--link))');
    expect(calmSeriesColor('#e11d2e')).toBe('rgb(var(--link))');
    expect(calmSeriesColor('hsl(150 60% 45%)')).toBe('hsl(150 60% 45%)');
    expect(calmSeriesColor('hsl(40 80% 50%)')).toBe('hsl(40 80% 50%)');
    expect(calmSeriesColor('rgb(var(--link))')).toBe('rgb(var(--link))');
  });
});
