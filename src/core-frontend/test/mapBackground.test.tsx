// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MapBackground from '../src/components/MapBackground';
import { hillsFor, placeMarks, ringPoint, tokenRgb, waveGlow, MAX_MARKS } from '../src/components/mapBackgroundLogic';
import { setAppearance } from '../src/appearance';

const api = vi.fn(async () => [{ id: 1, online: true, hasStatus: true }, { id: 2, online: false, hasStatus: true }]);
vi.mock('../src/api', async (orig) => ({ ...(await orig<typeof import('../src/api')>()), api: () => api() }));

describe('the map: geometry', () => {
  const hills = hillsFor(1920, 1000);
  it('puts three hills on the screen and bends the rings with time', () => {
    expect(hills).toHaveLength(3);
    expect(ringPoint(hills[0], 5, 1, 0)).not.toEqual(ringPoint(hills[0], 5, 1, 3));
    expect(hillsFor(390, 844)[0].step).toBeGreaterThanOrEqual(27 * 0.7);
    expect(hillsFor(5000, 3000)[0].step).toBeLessThanOrEqual(27 * 1.8);
  });
  it('lights the rings one after another', () => {
    expect(waveGlow(1, 1 / 3.2, 0, 17)).toBeCloseTo(1, 5);
    expect(waveGlow(10, 1 / 3.2, 0, 17)).toBeLessThan(0.01);
  });
  it('gives every asked server a stable place on the screen, beside the column of the page when it is wide', () => {
    const servers = [{ id: 1, online: true }, { id: 2, online: false }, { id: 3, online: true, maintenance: {} }, { id: 4, online: false, hasStatus: false }];
    const a = placeMarks(servers, hills, 1920, 1000);
    expect(a.map((m) => `${m.id}:${m.state}`)).toEqual(['1:on', '2:off', '3:maint']);
    expect(placeMarks(servers, hills, 1920, 1000)).toEqual(a);
    for (const m of a) {
      const [x, y] = ringPoint(hills[m.hill], m.ring, m.angle, 0);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1920);
      expect(y < 70 || y > 910 || x < 376 || x > 1544).toBe(true);
    }
    expect(placeMarks(Array.from({ length: 60 }, (_, i) => ({ id: i + 1, online: true })), hills, 1920, 1000).length).toBeLessThanOrEqual(MAX_MARKS);
  });
  it('reads a colour token of the theme', () => {
    expect(tokenRgb(' 214 66 10 ', [0, 0, 0])).toEqual([214, 66, 10]);
    expect(tokenRgb('', [1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('the map: on the page', () => {
  const strokes = vi.fn();
  beforeEach(() => {
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'stroke' ? strokes : () => undefined), set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); strokes.mockClear(); api.mockClear(); document.documentElement.removeAttribute('data-motion'); act(() => setAppearance({ noMap: false, highContrast: false, reduceMotion: false })); });

  it('is a decoration that draws the lines and asks for the servers', async () => {
    render(<MapBackground />);
    const c = screen.getByTestId('map-bg');
    expect(c.getAttribute('aria-hidden')).toBe('true');
    await act(async () => { await Promise.resolve(); });
    expect(api).toHaveBeenCalled();
    expect(strokes).toHaveBeenCalled();
  });
  it('asks for no frames when less motion is wanted', () => {
    act(() => setAppearance({ reduceMotion: true }));
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    render(<MapBackground />);
    expect(raf).not.toHaveBeenCalled();
    expect(strokes).toHaveBeenCalled();
  });
  it('is not there when switched off or with the high contrast', () => {
    act(() => setAppearance({ noMap: true }));
    const { container } = render(<MapBackground />);
    expect(container.querySelector('canvas')).toBeNull();
    act(() => setAppearance({ noMap: false, highContrast: true }));
    expect(container.querySelector('canvas')).toBeNull();
    act(() => setAppearance({ highContrast: false }));
    expect(container.querySelector('canvas')).toBeTruthy();
  });
});
