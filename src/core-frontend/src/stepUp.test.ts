import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStepUp, setReauthHandler } from './api';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('fetchStepUp', () => {
  it('a protected action is confirmed once and then repeated', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(403, { error: 'x', code: 'reauth_required' }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal('fetch', f);
    const ask = vi.fn(async () => true);
    setReauthHandler(ask);
    const r = await fetchStepUp('/api/servers/1', { method: 'DELETE' });
    expect(r.status).toBe(200);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a refusal to confirm leaves the original answer', async () => {
    const f = vi.fn().mockResolvedValue(json(403, { error: 'x', code: 'reauth_required' }));
    vi.stubGlobal('fetch', f);
    setReauthHandler(async () => false);
    const r = await fetchStepUp('/api/servers/1', { method: 'DELETE' });
    expect(r.status).toBe(403);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('other answers are not touched, even a 403', async () => {
    const f = vi.fn().mockResolvedValue(json(403, { error: 'no', code: 'forbidden' }));
    vi.stubGlobal('fetch', f);
    const ask = vi.fn(async () => true);
    setReauthHandler(ask);
    expect((await fetchStepUp('/api/x')).status).toBe(403);
    expect(ask).not.toHaveBeenCalled();
  });
});
