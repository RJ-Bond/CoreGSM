// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, clearCache, onStale } from './api';

afterEach(() => { vi.restoreAllMocks(); clearCache(); });

describe('the last answers when the network is gone', () => {
  it('gives a list from the last good answer and says from when it is; other paths still fail', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    f.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1 }]), { status: 200 }));
    expect(await api('/servers')).toEqual([{ id: 1 }]);
    let stale: number | null = 0;
    onStale((v) => { stale = v; });
    expect(stale).toBeNull();
    f.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await api('/servers')).toEqual([{ id: 1 }]);
    expect(stale).toBeGreaterThan(0);
    f.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api('/me/notifications')).rejects.toThrow();
    // the network is back: the data is fresh again
    f.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 2 }]), { status: 200 }));
    expect(await api('/servers')).toEqual([{ id: 2 }]);
    expect(stale).toBeNull();
  });

  it('keeps nothing after the sign-out', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    f.mockResolvedValueOnce(new Response('[]', { status: 200 }));
    await api('/news');
    clearCache();
    f.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api('/news')).rejects.toThrow();
  });
});
