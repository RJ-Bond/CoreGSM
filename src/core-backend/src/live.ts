/**
 * Live updates: the panel opens one long GET /api/live (Server-Sent Events) and is told, as soon as a server has been
 * polled, that its list is out of date; it then reloads the list at once instead of waiting for its own timer.
 * Only a «something changed» signal travels, never data, so what a visitor may see is still decided by /api/servers.
 */
import type { Request, Response } from 'express';
import { log } from './logger.js';
import { onShutdown } from './shutdown.js';

const MAX_CLIENTS = 300;
const MAX_PER_IP = 8;
const KEEPALIVE_MS = 25_000;
/** several servers answer within a second: one signal for all of them */
const THROTTLE_MS = 1000;

const clients = new Map<Response, string>();
let timer: NodeJS.Timeout | undefined;
let lastSent = 0;

const send = (chunk: string) => {
  for (const res of clients.keys()) {
    try { res.write(chunk); } catch { clients.delete(res); }
  }
};

/** a server has a new state: tell the open panels (at most once a second) */
export function emitLive(): void {
  if (clients.size === 0 || timer) return;
  const wait = Math.max(0, lastSent + THROTTLE_MS - Date.now());
  timer = setTimeout(() => {
    timer = undefined;
    lastSent = Date.now();
    send(`event: status\ndata: ${lastSent}\n\n`);
  }, wait);
  timer.unref();
}

export const liveClients = (): number => clients.size;

/** GET /api/live */
export function liveHandler(req: Request, res: Response): void {
  const ip = req.ip ?? '';
  let same = 0;
  for (const v of clients.values()) if (v === ip) same++;
  if (clients.size >= MAX_CLIENTS || same >= MAX_PER_IP) {
    res.status(429).json({ error: 'Слишком много открытых подключений' });
    return;
  }
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n: ok\n\n');
  clients.set(res, ip);
  const beat = setInterval(() => { try { res.write(': keepalive\n\n'); } catch { /* the close handler removes it */ } }, KEEPALIVE_MS);
  beat.unref();
  req.on('close', () => { clearInterval(beat); clients.delete(res); });
}

// a long connection must not hold the server open when it is stopped
onShutdown('live connections', () => {
  for (const res of clients.keys()) { try { res.end(); } catch { /* already gone */ } }
  clients.clear();
  log.info('live connections closed');
});
