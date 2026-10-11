import { createRequire } from 'node:module';
import type { Agent } from 'node:http';
import { ProxyAgent, type Dispatcher } from 'undici';
import { socksDispatcher } from 'fetch-socks';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

export interface ProxySetup {
  /** dispatcher for Discord REST (HTTPS API) */
  rest: Dispatcher;
  /** agent for the Discord gateway WebSocket */
  ws: Agent;
  /** credentials-free description for logs */
  label: string;
}

/**
 * Parses PROXY_URL: socks5://[user:pass@]host:port, socks5h://..., http://..., https://...
 * SOCKS hostnames are always resolved by the proxy (socks5h), so DNS poisoning of Discord does not matter.
 */
export function parseProxy(raw: string): ProxySetup | null {
  const value = raw.trim();
  if (!value) return null;

  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`PROXY_URL is not a valid URL: ${value.replace(/\/\/.*@/, '//***@')}`);
  }

  const user = decodeURIComponent(u.username);
  const pass = decodeURIComponent(u.password);
  const label = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;

  switch (u.protocol) {
    case 'socks5:':
    case 'socks5h:':
    case 'socks:': {
      const port = Number(u.port) || 1080;
      const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
      return {
        rest: socksDispatcher({
          type: 5,
          host: u.hostname,
          port,
          ...(user ? { userId: user, password: pass } : {}),
        }) as unknown as Dispatcher,
        ws: new SocksProxyAgent(`socks5h://${auth}${u.hostname}:${port}`) as unknown as Agent,
        label,
      };
    }
    case 'http:':
    case 'https:':
      return {
        rest: new ProxyAgent(u.toString()),
        ws: new HttpsProxyAgent(u.toString()) as unknown as Agent,
        label,
      };
    default:
      throw new Error(`Unsupported proxy protocol "${u.protocol}". Use socks5://, socks5h://, http:// or https://`);
  }
}

/**
 * @discordjs/ws creates its gateway socket with `new (require("ws").WebSocket)(url, [], opts)` and offers no
 * way to pass an agent. We replace that export BEFORE discord.js is loaded, so every gateway connection
 * is tunnelled through the proxy. Must be called before `await import('discord.js')`.
 */
export function patchGatewayAgent(agent: Agent): void {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ws: any = require('ws');
  const Base = ws.WebSocket as new (...a: unknown[]) => unknown;

  class ProxiedWebSocket extends (Base as new (...a: unknown[]) => object) {
    constructor(url: string, protocols?: unknown, options: Record<string, unknown> = {}) {
      super(url, protocols, { ...options, agent });
    }
  }
  ws.WebSocket = ProxiedWebSocket;
}
