/** Calls to the panel's internal API. Inside the Docker network they never use the proxy. */
import { log } from './log.js';

const BACKEND = process.env.BACKEND_URL ?? 'http://backend:3000';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? '';

export async function backend(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(BACKEND + path, {
    ...init,
    headers: { 'x-internal-token': INTERNAL_TOKEN, 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
}

export async function backendJson<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const r = await backend(path, init);
  let data: T | null = null;
  try {
    data = (await r.json()) as T;
  } catch {
    /* not JSON */
  }
  return { ok: r.ok, status: r.status, data };
}

/** result of a status message update, shown on the binding in the panel */
export async function report(id: number, body: { messageId?: string | null; error?: string | null }): Promise<boolean> {
  try {
    const r = await backend(`/internal/bindings/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!r.ok) log(`report failed: HTTP ${r.status}`);
    return r.ok;
  } catch (e) {
    log('report failed', e);
    return false;
  }
}
