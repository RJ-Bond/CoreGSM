import { createRequire } from 'node:module';
import type { Agent } from 'node:http';
import { ProxyAgent, type Dispatcher } from 'undici';
import { socksDispatcher } from 'fetch-socks';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * Keep the HTTPS connection to Discord open between requests. undici closes an idle connection after 4 s by default,
 * and a new one through a SOCKS/HTTP proxy costs a TCP + SOCKS + TLS handshake (seconds on a far proxy): that alone
 * can exceed the 3 s Discord gives a slash command to answer («Приложение не отвечает»).
 */
// Idle sockets are kept for 20 s only (and refreshed by the bot every 10 s): a longer keep-alive meant reusing sockets
// that the proxy or Cloudflare had already closed, which fails with «other side closed».
const KEEP_ALIVE = { keepAliveTimeout: 20_000, keepAliveMaxTimeout: 60_000, connections: 4 };

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
        rest: socksDispatcher(
          {
            type: 5,
            host: u.hostname,
            port,
            ...(user ? { userId: user, password: pass } : {}),
          },
          KEEP_ALIVE,
        ) as unknown as Dispatcher,
        ws: new SocksProxyAgent(`socks5h://${auth}${u.hostname}:${port}`) as unknown as Agent,
        label,
      };
    }
    case 'http:':
    case 'https:':
      return {
        rest: new ProxyAgent({ uri: u.toString(), ...KEEP_ALIVE }),
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
 * is tunnelled through whatever proxy `getAgent()` returns at connect time (none = direct). Must be called before `await import('discord.js')`.
 */
export function patchGatewayAgent(getAgent: () => Agent | undefined): void {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ws: any = require('ws');
  const Base = ws.WebSocket as new (...a: unknown[]) => unknown;

  class ProxiedWebSocket extends (Base as new (...a: unknown[]) => object) {
    constructor(url: string, protocols?: unknown, options: Record<string, unknown> = {}) {
      const agent = getAgent();
      super(url, protocols, agent ? { ...options, agent } : options);
    }
  }
  ws.WebSocket = ProxiedWebSocket;
}
