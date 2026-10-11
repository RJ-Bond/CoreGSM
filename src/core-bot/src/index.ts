import type { Agent } from 'node:http';
import { parseProxy, patchGatewayAgent } from './proxy.js';

const BACKEND = process.env.BACKEND_URL ?? 'http://backend:3000';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? '';
const TICK_MS = 10_000;
const LOGIN_RETRY_MS = 60_000;

// The gateway socket is created inside discord.js, so the proxy hook must be installed before it is loaded.
// The agent is looked up on every (re)connect, which lets the panel change the proxy without a restart.
let gatewayAgent: Agent | undefined;
patchGatewayAgent(() => gatewayAgent);
const { AttachmentBuilder, Client, EmbedBuilder, GatewayIntentBits } = await import('discord.js');
type DiscordClient = InstanceType<typeof Client>;

interface Binding {
  id: number;
  serverId: number;
  serverName: string;
  channelId: string;
  messageId: string | null;
  intervalSec: number;
}

interface BotConfig {
  discordToken: string;
  proxyUrl: string;
}

type BotState = 'idle' | 'connecting' | 'online' | 'error';

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

// Calls to the backend inside the Docker network never use the proxy.
async function backend(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(BACKEND + path, {
    ...init,
    headers: { 'x-internal-token': INTERNAL_TOKEN, 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
}

async function report(id: number, body: { messageId?: string | null; error?: string | null }) {
  try {
    await backend(`/internal/bindings/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  } catch (e) {
    log('report failed', e);
  }
}

// ---------- state ----------
let client: DiscordClient | null = null;
let appliedKey: string | null = null;
let retryAt = 0;
let failedKey: string | null = null;
let state: BotState = 'idle';
let tag: string | null = null;
let lastError: string | null = null;
const lastRun = new Map<number, number>();

async function publishStatus(): Promise<void> {
  try {
    await backend('/internal/bot-status', { method: 'POST', body: JSON.stringify({ state, tag, error: lastError }) });
  } catch {
    /* backend is restarting: the next tick will retry */
  }
}

function setState(s: BotState, opts: { tag?: string | null; error?: string | null } = {}) {
  state = s;
  tag = opts.tag ?? null;
  lastError = opts.error ?? null;
}

async function stopClient(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  try {
    await c.destroy();
  } catch {
    /* ignore */
  }
}

/** Fetches token/proxy from the panel and (re)connects when they change. */
async function applyConfig(): Promise<void> {
  const res = await backend('/internal/config');
  if (!res.ok) throw new Error(`config HTTP ${res.status}`);
  const cfg = (await res.json()) as BotConfig;
  const key = `${cfg.discordToken}|${cfg.proxyUrl}`;
  if (key === appliedKey) return;
  // after a failure wait before retrying the SAME config; a changed config is applied immediately
  if (key === failedKey && Date.now() < retryAt) return;
  appliedKey = key;
  failedKey = null;

  await stopClient();
  gatewayAgent = undefined;
  lastRun.clear();

  if (!cfg.discordToken) {
    setState('idle');
    log('No Discord token configured. Add it in the panel: Settings.');
    return;
  }

  let proxy = null;
  try {
    proxy = parseProxy(cfg.proxyUrl);
  } catch (e) {
    setState('error', { error: (e as Error).message });
    log('Proxy config error:', (e as Error).message);
    appliedKey = null;
    failedKey = key;
    retryAt = Date.now() + LOGIN_RETRY_MS;
    return;
  }
  gatewayAgent = proxy?.ws;
  if (proxy) log('Using proxy for Discord:', proxy.label);

  const c = new Client({
    intents: [GatewayIntentBits.Guilds],
    ...(proxy ? { rest: { agent: proxy.rest } } : {}),
  });
  c.on('error', (e) => log('client error', e));
  client = c;
  setState('connecting');
  try {
    await c.login(cfg.discordToken);
    log(`Logged in as ${c.user?.tag}`);
    setState('online', { tag: c.user?.tag ?? null });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 250);
    log('Discord login failed:', msg);
    setState('error', { error: msg });
    await stopClient();
    // do not hammer Discord: retry later with the same config
    appliedKey = null;
    failedKey = key;
    retryAt = Date.now() + LOGIN_RETRY_MS;
  }
}

async function update(c: DiscordClient, b: Binding): Promise<void> {
  const img = await backend(`/api/card/${b.serverId}.png`, { headers: { 'content-type': 'image/png' } });
  if (!img.ok) throw new Error(`card HTTP ${img.status}`);
  const png = Buffer.from(await img.arrayBuffer());

  const channel = await c.channels.fetch(b.channelId);
  if (!channel || !channel.isTextBased() || !('send' in channel)) throw new Error('Канал не найден или не текстовый');

  const payload = () => ({
    embeds: [new EmbedBuilder().setColor(0x5a4bd1).setImage('attachment://card.png').setTimestamp()],
    files: [new AttachmentBuilder(png, { name: 'card.png' })],
  });

  if (b.messageId) {
    try {
      const msg = await channel.messages.fetch(b.messageId);
      await msg.edit({ ...payload(), attachments: [] });
      return await report(b.id, { error: null });
    } catch (e) {
      log(`binding ${b.id}: cannot edit message, posting a new one`, (e as Error).message);
    }
  }
  const sent = await channel.send(payload());
  await report(b.id, { messageId: sent.id, error: null });
}

async function updateBindings(): Promise<void> {
  const c = client;
  if (!c || state !== 'online') return;
  const res = await backend('/internal/bindings');
  if (!res.ok) throw new Error(`bindings HTTP ${res.status}`);
  const list = (await res.json()) as Binding[];
  const ids = new Set(list.map((b) => b.id));
  for (const k of lastRun.keys()) if (!ids.has(k)) lastRun.delete(k);
  for (const b of list) {
    if (Date.now() - (lastRun.get(b.id) ?? 0) < b.intervalSec * 1000) continue;
    lastRun.set(b.id, Date.now());
    try {
      await update(c, b);
      log(`binding ${b.id} (${b.serverName}) updated`);
    } catch (e) {
      const msg = (e as Error).message.slice(0, 250);
      log(`binding ${b.id} failed:`, msg);
      await report(b.id, { error: msg });
    }
  }
}

let busy = false;
async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await applyConfig();
    await updateBindings();
  } catch (e) {
    log('tick failed:', (e as Error).message);
  } finally {
    busy = false;
    await publishStatus();
  }
}

log('CoreGSM bot started; waiting for configuration from the panel.');
void tick();
setInterval(() => void tick(), TICK_MS);
