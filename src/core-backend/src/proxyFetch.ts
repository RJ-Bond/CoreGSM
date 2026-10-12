/**
 * fetch() for Discord requests made by the backend (OAuth sign-in): goes through the same proxy as the bot
 * (setting `proxy_url`: socks5://, socks5h://, http:// or https://), because Discord is often blocked directly.
 */
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { socksDispatcher } from 'fetch-socks';
import { getSetting } from './db.js';

let cache: { url: string; dispatcher: Dispatcher } | null = null;

function dispatcherFor(raw: string): Dispatcher | null {
  if (cache && cache.url === raw) return cache.dispatcher;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  let d: Dispatcher | null = null;
  if (u.protocol === 'socks5:' || u.protocol === 'socks5h:' || u.protocol === 'socks:') {
    const user = decodeURIComponent(u.username);
    d = socksDispatcher({
      type: 5,
      host: u.hostname,
      port: Number(u.port) || 1080,
      ...(user ? { userId: user, password: decodeURIComponent(u.password) } : {}),
    }) as unknown as Dispatcher;
  } else if (u.protocol === 'http:' || u.protocol === 'https:') {
    d = new ProxyAgent(u.toString());
  }
  if (d) cache = { url: raw, dispatcher: d };
  return d;
}

export async function discordFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams; timeoutMs?: number } = {}) {
  const proxy = getSetting('proxy_url');
  const dispatcher = proxy ? dispatcherFor(proxy) : null;
  const { timeoutMs = 12_000, ...rest } = init;
  return undiciFetch(url, {
    ...rest,
    signal: AbortSignal.timeout(timeoutMs),
    ...(dispatcher ? { dispatcher } : {}),
  });
}
