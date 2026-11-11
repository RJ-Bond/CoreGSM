import { describe, expect, it } from 'vitest';
import { rumRoute, worstShiftWindow } from './rum';

describe('rumRoute: the page a visit began on', () => {
  it('names the pages of the panel with the same short list as the backend', () => {
    expect(rumRoute('/')).toBe('servers');
    expect(rumRoute('/servers')).toBe('servers');
    expect(rumRoute('/servers/12')).toBe('server');
    expect(rumRoute('/servers/12/players')).toBe('server');
    expect(rumRoute('/servers/abc')).toBe('servers');
    for (const p of ['news', 'status', 'community', 'profile', 'login', 'register', 'admin']) expect(rumRoute(`/${p}`)).toBe(p);
    expect(rumRoute('/admin/settings/brand')).toBe('admin');
    expect(rumRoute('/player/Bravo')).toBe('player');
    expect(rumRoute('/u/admin')).toBe('player');
    expect(rumRoute('/nope')).toBe('other');
  });
});

describe('worstShiftWindow: the layout shifts count in windows', () => {
  it('is nothing without shifts and adds the shifts that come close together', () => {
    expect(worstShiftWindow([])).toBe(0);
    expect(worstShiftWindow([{ at: 100, value: 0.02 }, { at: 600, value: 0.03 }])).toBeCloseTo(0.05, 5);
  });

  it('starts a new window after a second of quiet and keeps the worst one', () => {
    const shifts = [{ at: 0, value: 0.04 }, { at: 3000, value: 0.01 }, { at: 3500, value: 0.02 }];
    expect(worstShiftWindow(shifts)).toBeCloseTo(0.04, 5);
  });

  it('closes a window that lasts five seconds even when the shifts keep coming', () => {
    const shifts = Array.from({ length: 8 }, (_, i) => ({ at: i * 900, value: 0.01 }));
    // 0 .. 4500 ms in the first window (6 shifts), then a new one
    expect(worstShiftWindow(shifts)).toBeCloseTo(0.06, 5);
  });
});
