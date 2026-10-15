/** The bot's main loop: connection to Discord from the panel's settings, status messages, news and deliveries. */
import { ChannelType, Client, EmbedBuilder, GatewayIntentBits } from 'discord.js';
import { backend, report } from './backend.js';
import { handleInteraction, registerCommands } from './commands.js';
import { deliveryFailure, humanDiscordError, newNonce, retryAfterOf, retrySocket } from './errors.js';
import { setGatewayAgent } from './gateway.js';
import { log } from './log.js';
import { buildNews, buildPayload, type Binding, type NewsPayload } from './messages.js';
import { parseProxy } from './proxy.js';

const TICK_MS = 10_000;
const LOGIN_RETRY_MS = 60_000;

interface BotConfig {
  discordToken: string;
  proxyUrl: string;
}

type BotState = 'idle' | 'connecting' | 'online' | 'error';

// ---------- state ----------
let client: Client | null = null;
let appliedKey: string | null = null;
let retryAt = 0;
let failedKey: string | null = null;
let state: BotState = 'idle';
let tag: string | null = null;
let lastError: string | null = null;
let clientId: string | null = null;
let commandsCount: number | null = null;
const lastRun = new Map<number, number>();

async function publishStatus(): Promise<void> {
  try {
    await backend('/internal/bot-status', { method: 'POST', body: JSON.stringify({ state, tag, clientId, error: lastError, commands: commandsCount }) });
  } catch {
    /* backend is restarting: the next tick will retry */
  }
}

function setState(s: BotState, opts: { tag?: string | null; clientId?: string | null; error?: string | null } = {}) {
  state = s;
  tag = opts.tag ?? null;
  clientId = opts.clientId ?? null;
  lastError = opts.error ?? null;
}

let lastGuildsJson = '';
let lastGuildsAt = 0;

const PERM_LABELS: Record<string, string> = {
  EmbedLinks: 'Встраивание ссылок',
  AttachFiles: 'Прикрепление файлов',
};

/** Text channels per Discord server. A channel is listed when the bot can see it and write to it;
 *  missing "soft" permissions are reported as warnings instead of hiding the channel. */
function collectGuilds(c: Client) {
  const out: { id: string; name: string; hidden: number; channels: { id: string; name: string; pos: number; missing: string[] }[] }[] = [];
  for (const g of c.guilds.cache.values()) {
    const me = g.members.me;
    const channels: { id: string; name: string; pos: number; missing: string[] }[] = [];
    let hidden = 0;
    for (const ch of g.channels.cache.values()) {
      if (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement) continue;
      const perms = me ? ch.permissionsFor(me) : null;
      if (perms && !perms.has(['ViewChannel', 'SendMessages'])) { hidden++; continue; }
      const missing = perms ? (['EmbedLinks', 'AttachFiles'] as const).filter((p) => !perms.has(p)).map((p) => PERM_LABELS[p]) : [];
      channels.push({ id: ch.id, name: ch.name, pos: ch.rawPosition, missing });
    }
    channels.sort((x, y) => x.pos - y.pos);
    out.push({ id: g.id, name: g.name, hidden, channels: channels.slice(0, 250) });
  }
  return out.slice(0, 50);
}

async function publishGuilds(): Promise<void> {
  if (!client || state !== 'online') return;
  const list = collectGuilds(client).map((g) => ({
    id: g.id,
    name: g.name,
    hidden: g.hidden,
    channels: g.channels.map(({ id, name, missing }) => ({ id, name, ...(missing.length ? { missing } : {}) })),
  }));
  const json = JSON.stringify(list);
  // send on change, and every minute so a restarted backend learns the list again
  if (json === lastGuildsJson && Date.now() - lastGuildsAt < 60_000) return;
  try {
    const r = await backend('/internal/bot-guilds', { method: 'POST', body: json });
    if (r.ok) {
      if (json !== lastGuildsJson) {
        const hiddenTotal = list.reduce((n, g) => n + g.hidden, 0);
        log(`Discord servers visible to the bot: ${list.length}, text channels it can post in: ${list.reduce((n, g) => n + g.channels.length, 0)}${hiddenTotal ? `, hidden (no access): ${hiddenTotal}` : ''}`);
        for (const g of list) log(`  ${g.name}: ${g.channels.length} channels${g.hidden ? `, ${g.hidden} without access` : ''}`);
      }
      lastGuildsJson = json;
      lastGuildsAt = Date.now();
    }
  } catch {
    /* retry on the next tick */
  }
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
  setGatewayAgent(undefined);
  commandsCount = null;
  lastRun.clear();
  lastGuildsJson = '';

  if (!cfg.discordToken) {
    setState('idle');
    // forget the channel list of a bot that is no longer configured
    backend('/internal/bot-guilds', { method: 'POST', body: '[]' }).catch(() => undefined);
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
  setGatewayAgent(proxy?.ws);
  if (proxy) log('Using proxy for Discord:', proxy.label);

  const c = new Client({
    intents: [GatewayIntentBits.Guilds],
    rest: { timeout: 10_000, ...(proxy ? { agent: proxy.rest } : {}) },
  });
  c.on('error', (e) => log('client error', e));
  // added to / kicked from a Discord server: tell the panel at once instead of waiting for the next tick
  const guildsChanged = () => {
    lastGuildsAt = 0;
    lastGuildsJson = '';
    void publishGuilds().catch(() => undefined);
  };
  c.on('guildCreate', guildsChanged);
  c.on('guildDelete', guildsChanged);
  c.on('interactionCreate', (i) => {
    if (stopping) return;
    void handleInteraction(i).catch((e) => log('interaction failed:', (e as Error).message));
  });
  client = c;
  setState('connecting');
  try {
    await c.login(cfg.discordToken);
    log(`Logged in as ${c.user?.tag}`);
    setState('online', { tag: c.user?.tag ?? null, clientId: c.user?.id ?? null });
    void registerCommands(c).then(async (n) => {
      commandsCount = n;
      await publishStatus();
    });
  } catch (e) {
    log('Discord login failed:', (e as Error).message);
    setState('error', { error: humanDiscordError(e) });
    await stopClient();
    // do not hammer Discord: retry later with the same config
    appliedKey = null;
    failedKey = key;
    retryAt = Date.now() + LOGIN_RETRY_MS;
  }
}

async function update(c: Client, b: Binding): Promise<void> {
  const built = await buildPayload(b);

  const channel = await retrySocket(() => c.channels.fetch(b.channelId));
  if (!channel || !channel.isTextBased() || !('send' in channel)) throw new Error('Канал не найден или не текстовый');

  if (b.messageId) {
    try {
      const msg = await retrySocket(() => channel.messages.fetch(b.messageId!));
      // attachments: [] drops a picture left over from a previous style
      await retrySocket(() => msg.edit({ ...built, attachments: [] }));
      return await report(b.id, { error: null });
    } catch (e) {
      log(`binding ${b.id}: cannot edit message, posting a new one`, (e as Error).message);
    }
  }
  const nonce = newNonce();
  const sent = await retrySocket<{ id: string }>(() => channel.send({ ...built, nonce, enforceNonce: true }));
  await report(b.id, { messageId: sent.id, error: null });
}

interface NewsItem {
  id: number;
  action: 'send' | 'edit' | 'delete';
  channelId: string;
  messageId: string | null;
  payload: NewsPayload;
  /** ready Discord embeds (server status cards) appended after the written ones */
  statusEmbeds?: Record<string, unknown>[];
  test?: boolean;
}

async function reportNews(id: number, body: { status: 'sent' | 'error' | 'deleted'; messageId?: string | null; error?: string | null; retryAfterMs?: number }) {
  try {
    await backend(`/internal/news/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  } catch (e) {
    log('news report failed', e);
  }
}

async function processNews(): Promise<void> {
  const c = client;
  if (!c || state !== 'online') return;
  const res = await backend('/internal/news/pending');
  if (!res.ok) throw new Error(`news HTTP ${res.status}`);
  const items = (await res.json()) as NewsItem[];
  for (const it of items) {
    // shutting down: items not started yet are claimed again by the next start
    if (stopping) break;
    try {
      const channel = await retrySocket(() => c.channels.fetch(it.channelId));
      if (!channel || !channel.isTextBased() || !('send' in channel)) throw new Error('Канал не найден или не текстовый');

      if (it.action === 'delete') {
        try {
          if (it.messageId) await (await channel.messages.fetch(it.messageId)).delete();
        } catch (e) {
          if ((e as { code?: number }).code !== 10008) throw e; // already gone: that is fine
        }
        await reportNews(it.id, { status: 'deleted' });
        log(`news ${it.id}: message deleted`);
        continue;
      }

      const msg = await buildNews(it.payload, it.statusEmbeds ?? []);
      if (it.action === 'edit' && it.messageId) {
        const m = await retrySocket(() => channel.messages.fetch(it.messageId!));
        await retrySocket(() => m.edit({ content: msg.content ?? '', embeds: msg.embeds, files: msg.files, components: msg.components, attachments: [], allowedMentions: msg.allowedMentions }));
        await reportNews(it.id, { status: 'sent', messageId: it.messageId });
        log(`news ${it.id}: message edited`);
      } else {
        const nonce = newNonce();
        const sent = await retrySocket<{ id: string }>(() => channel.send({ ...msg, nonce, enforceNonce: true }));
        await reportNews(it.id, { status: 'sent', messageId: sent.id });
        log(`news ${it.id}: posted`);
      }
    } catch (e) {
      log(`news ${it.id} failed:`, (e as Error).message);
      const wait = retryAfterOf(e);
      await reportNews(it.id, { status: 'error', error: humanDiscordError(e), ...(wait ? { retryAfterMs: wait } : {}) });
      if (wait) break; // Discord asked us to slow down: the rest of the batch waits for the next tick
    }
  }
}

/** Alerts (channel messages) and DMs from the panel's delivery queue; every result is reported per delivery. */
interface DeliveryItem {
  id: number;
  kind: 'alert' | 'dm' | 'status';
  target: string;
  payload: { content?: string; mention?: 'none' | 'here' | 'everyone'; embed?: ConstructorParameters<typeof EmbedBuilder>[0] };
}
async function processDeliveries(): Promise<void> {
  const c = client;
  if (!c || state !== 'online') return;
  const res = await backend('/internal/deliveries/pending?kinds=alert,dm');
  if (!res.ok) throw new Error(`deliveries HTTP ${res.status}`);
  const items = (await res.json()) as DeliveryItem[];
  for (const it of items) {
    if (stopping) break;
    let body: { ok: boolean; error?: string; final?: boolean; retryAfterMs?: number } = { ok: true };
    let limited = false;
    try {
      if (it.kind === 'dm') {
        const user = await c.users.fetch(it.target);
        await user.send({ content: (it.payload.content ?? '').slice(0, 2000), allowedMentions: { parse: [] } });
      } else {
        const channel = await c.channels.fetch(it.target);
        if (!channel || !channel.isTextBased() || !('send' in channel)) throw Object.assign(new Error('Канал не найден или не текстовый'), { code: 10003 });
        await channel.send({
          content: it.payload.content || undefined,
          embeds: it.payload.embed ? [new EmbedBuilder(it.payload.embed)] : [],
          allowedMentions: { parse: ((it.payload.mention ?? 'none') === 'none' ? [] : ['everyone']) as 'everyone'[] },
        });
      }
      log(`delivery ${it.id} (${it.kind}): sent`);
    } catch (e) {
      const f = deliveryFailure(e);
      log(`delivery ${it.id} (${it.kind}) failed:`, (e as Error).message);
      body = { ok: false, error: f.text, final: f.final, ...(f.retryAfterMs ? { retryAfterMs: f.retryAfterMs } : {}) };
      limited = !!f.retryAfterMs;
    }
    try {
      await backend(`/internal/deliveries/${it.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    } catch (e) {
      log('delivery report failed', e);
    }
    // 429: stop for this tick, the remaining deliveries stay queued; a short pause between sends keeps us under the limits
    if (limited) break;
    await new Promise((r) => setTimeout(r, 300));
  }
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
    if (stopping) break;
    if (Date.now() - (lastRun.get(b.id) ?? 0) < b.intervalSec * 1000) continue;
    lastRun.set(b.id, Date.now());
    try {
      await update(c, b);
      log(`binding ${b.id} (${b.serverName}) updated`);
    } catch (e) {
      log(`binding ${b.id} failed:`, (e as Error).message);
      await report(b.id, { error: humanDiscordError(e) });
    }
  }
}

let busy = false;
let stopping = false;
let timer: NodeJS.Timeout | undefined;

async function tick(): Promise<void> {
  if (busy || stopping) return;
  busy = true;
  try {
    await applyConfig();
    await publishGuilds();
    await updateBindings();
    await processNews();
    await processDeliveries();
  } catch (e) {
    log('tick failed:', (e as Error).message);
  } finally {
    busy = false;
    if (!stopping) await publishStatus();
  }
}

export function start(): void {
  log('CoreGSM bot started; waiting for configuration from the panel.');
  void tick();
  timer = setInterval(() => void tick(), TICK_MS);
}

/**
 * SIGTERM (docker stop, an update): no new ticks or commands, the message being sent is finished (so it is
 * reported and not posted twice after the restart), then the gateway connection is closed cleanly.
 */
export async function stop(signal: string, graceMs = 7000): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  log(`${signal}: shutting down`);
  const until = Date.now() + graceMs;
  while (busy && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  if (busy) log('the current tick did not finish in time');
  await stopClient();
  log('stopped');
}
