import { describe, expect, it } from 'vitest';
import { verdict, type ProbeView } from './ProbesView';

const pt = (name: string, online: boolean | null) => ({ name, online, ping: online ? 40 : null, updatedAt: 1, uptime: null });
const view = (panel: boolean | null, ...probes: (boolean | null)[]): ProbeView => ({ panel: pt('Панель', panel), probes: probes.map((o, i) => pt(`P${i + 1}`, o)) });

describe('availability verdict', () => {
  it('everyone sees it: ok; nobody: bad; nothing fresh: mute', () => {
    expect(verdict(view(true, true, true)).tone).toBe('ok');
    expect(verdict(view(false, false)).tone).toBe('bad');
    expect(verdict(view(null, null)).tone).toBe('mute');
  });
  it('some see it: a network problem, the silent points named; stale points are left out', () => {
    const v = verdict(view(false, true, null));
    expect(v.tone).toBe('warn');
    expect(v.text).toContain('«Панель»');
    expect(v.text).not.toContain('P2');
  });
});
