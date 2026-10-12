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
const { AttachmentBuilder, ChannelType, Client, EmbedBuilder, GatewayIntentBits } = await import('discord.js');
type DiscordClient = InstanceType<typeof Client>;

interface Binding {
  id: number;
  serverId: number;
  serverName: string;
  channelId: string;
  messageId: string | null;
  intervalSec: number;
  /** embed (default), card (PNG) or both */
  style?: 'embed' | 'card' | 'both';
}

/** Binding as the buttons need it: also available while paused. */

interface BotConfig {
  discordToken: string;
  proxyUrl: string;
}

type BotState = 'idle' | 'connecting' | 'online' | 'error';

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** Turns Discord/network errors into a message a person can act on (shown in the panel). */
function humanDiscordError(e: unknown): string {
  const err = e as { code?: number | string; message?: string };
  const m = String(err?.message ?? e);
  switch (err?.code) {
    case 50001: return 'У бота нет доступа к каналу. Пригласите бота на этот сервер и выдайте права на канал.';
    case 10003: return 'Канал не найден. Проверьте ID и что бот приглашён на сервер, где находится канал.';
    case 50013: return 'Не хватает прав: боту нужны «Отправка сообщений», «Прикрепление файлов» и «Встраивание ссылок» в этом канале.';
    case 50035: return 'Discord отклонил сообщение: проверьте ссылки (они должны начинаться с http:// или https://) и длину текстов.';
    case 10008: return 'Сообщение уже удалено в Discord.';
    case 'TokenInvalid': return 'Токен неверный или сброшен. Получите новый: Developer Portal → Bot → Reset Token.';
  }
  if (/invalid token|token.*invalid/i.test(m)) return 'Токен неверный или сброшен. Получите новый: Developer Portal → Bot → Reset Token.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|timeout|socks|proxy/i.test(m)) {
    return 'Нет связи с Discord. Проверьте интернет сервера или настройте прокси в разделе «Настройки».';
  }
  return m.slice(0, 200);
}

// Calls to the backend inside the Docker network never use the proxy.
async function backend(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(BACKEND + path, {
    ...init,
    headers: { 'x-internal-token': INTERNAL_TOKEN, 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(20_000),
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
let clientId: string | null = null;
const lastRun = new Map<number, number>();

async function publishStatus(): Promise<void> {
  try {
    await backend('/internal/bot-status', { method: 'POST', body: JSON.stringify({ state, tag, clientId, error: lastError }) });
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

/** Text channels the bot can post in, grouped by server. */
const PERM_LABELS: Record<string, string> = {
  EmbedLinks: 'Встраивание ссылок',
  AttachFiles: 'Прикрепление файлов',
};

/** Text channels per Discord server. A channel is listed when the bot can see it and write to it;
 *  missing "soft" permissions are reported as warnings instead of hiding the channel. */
function collectGuilds(c: DiscordClient) {
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
  gatewayAgent = undefined;
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
    setState('online', { tag: c.user?.tag ?? null, clientId: c.user?.id ?? null });
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

/** Builds what a binding's message looks like (embed and card attachment). */
async function buildPayload(b: Binding) {
  const style = b.style ?? 'embed';

  // the embed layout (emojis, fields, colours) is defined once in the backend and shared with the panel preview
  let embed: InstanceType<typeof EmbedBuilder>;
  if (style === 'card') {
    embed = new EmbedBuilder().setColor(0x5a4bd1).setTimestamp();
  } else {
    const r = await backend(`/internal/servers/${b.serverId}/embed?interval=${b.intervalSec}`);
    if (!r.ok) throw new Error(`embed HTTP ${r.status}`);
    embed = new EmbedBuilder((await r.json()) as ConstructorParameters<typeof EmbedBuilder>[0]);
  }

  const files: InstanceType<typeof AttachmentBuilder>[] = [];
  if (style !== 'embed') {
    const img = await backend(`/internal/card/${b.serverId}.png`);
    if (!img.ok) throw new Error(`card HTTP ${img.status}`);
    files.push(new AttachmentBuilder(Buffer.from(await img.arrayBuffer()), { name: 'card.png' }));
    embed.setImage('attachment://card.png');
  }
  return { embeds: [embed], files, components: [] };
}

async function update(c: DiscordClient, b: Binding): Promise<void> {
  const built = await buildPayload(b);

  const channel = await c.channels.fetch(b.channelId);
  if (!channel || !channel.isTextBased() || !('send' in channel)) throw new Error('Канал не найден или не текстовый');

  const payload = () => built;

  if (b.messageId) {
    try {
      const msg = await channel.messages.fetch(b.messageId);
      // attachments: [] drops a picture left over from a previous style
      await msg.edit({ ...payload(), attachments: [] });
      return await report(b.id, { error: null });
    } catch (e) {
      log(`binding ${b.id}: cannot edit message, posting a new one`, (e as Error).message);
    }
  }
  const sent = await channel.send(payload());
  await report(b.id, { messageId: sent.id, error: null });
}

// ---------- news: messages written in the panel ----------
interface NewsPayload {
  content: string;
  mention: 'none' | 'here' | 'everyone';
  embed?: {
    title?: string;
    url?: string;
    description?: string;
    color?: number;
    author?: { name: string; iconUrl?: string };
    thumbnailUrl?: string;
    image?: { url?: string; upload?: string };
    fields?: { name: string; value: string; inline?: boolean }[];
    footer?: { text: string };
    timestamp?: boolean;
  };
}
interface NewsItem {
  id: number;
  action: 'send' | 'edit' | 'delete';
  channelId: string;
  messageId: string | null;
  payload: NewsPayload;
}

async function buildNews(p: NewsPayload) {
  const files: InstanceType<typeof AttachmentBuilder>[] = [];
  const mention = p.mention === 'everyone' ? '@everyone' : p.mention === 'here' ? '@here' : '';
  const content = [mention, p.content?.trim()].filter(Boolean).join('\n');
  const embeds: InstanceType<typeof EmbedBuilder>[] = [];
  const e = p.embed;
  if (e) {
    const eb = new EmbedBuilder().setColor(e.color ?? 0x5865f2);
    if (e.title) eb.setTitle(e.title);
    if (e.url) eb.setURL(e.url);
    if (e.description) eb.setDescription(e.description);
    if (e.author?.name) eb.setAuthor({ name: e.author.name, ...(e.author.iconUrl ? { iconURL: e.author.iconUrl } : {}) });
    if (e.thumbnailUrl) eb.setThumbnail(e.thumbnailUrl);
    if (e.image?.upload) {
      // a picture uploaded in the panel travels as an attachment
      const r = await backend(`/api/news/images/${e.image.upload}`);
      if (!r.ok) throw new Error('Не удалось получить загруженную картинку (она могла быть удалена)');
      files.push(new AttachmentBuilder(Buffer.from(await r.arrayBuffer()), { name: e.image.upload }));
      eb.setImage(`attachment://${e.image.upload}`);
    } else if (e.image?.url) {
      eb.setImage(e.image.url);
    }
    if (e.fields?.length) eb.addFields(e.fields.map((x) => ({ name: x.name, value: x.value, inline: !!x.inline })));
    if (e.footer?.text) eb.setFooter({ text: e.footer.text });
    if (e.timestamp) eb.setTimestamp();
    embeds.push(eb);
  }
  return {
    content: content || undefined,
    embeds,
    files,
    allowedMentions: { parse: (p.mention === 'none' ? [] : ['everyone']) as 'everyone'[] },
  };
}

async function reportNews(id: number, body: { status: 'sent' | 'error' | 'deleted'; messageId?: string | null; error?: string | null }) {
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
    try {
      const channel = await c.channels.fetch(it.channelId);
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

      const msg = await buildNews(it.payload);
      if (it.action === 'edit' && it.messageId) {
        const m = await channel.messages.fetch(it.messageId);
        await m.edit({ content: msg.content ?? '', embeds: msg.embeds, files: msg.files, attachments: [], allowedMentions: msg.allowedMentions });
        await reportNews(it.id, { status: 'sent', messageId: it.messageId });
        log(`news ${it.id}: message edited`);
      } else {
        const sent = await channel.send(msg);
        await reportNews(it.id, { status: 'sent', messageId: sent.id });
        log(`news ${it.id}: posted`);
      }
    } catch (e) {
      log(`news ${it.id} failed:`, (e as Error).message);
      await reportNews(it.id, { status: 'error', error: humanDiscordError(e) });
    }
  }
}

/** alerts about game servers going down / coming back (queued by the panel) */
async function processAlerts(): Promise<void> {
  const c = client;
  if (!c || state !== 'online') return;
  const res = await backend('/internal/alerts/pending');
  if (!res.ok) throw new Error(`alerts HTTP ${res.status}`);
  const items = (await res.json()) as { id: number; channelId: string; payload: { content: string; mention: 'none' | 'here' | 'everyone'; embed: ConstructorParameters<typeof EmbedBuilder>[0] } }[];
  for (const it of items) {
    let body: { status: 'sent' | 'error'; error?: string } = { status: 'sent' };
    try {
      const channel = await c.channels.fetch(it.channelId);
      if (!channel || !channel.isTextBased() || !('send' in channel)) throw new Error('Канал не найден или не текстовый');
      await channel.send({
        content: it.payload.content || undefined,
        embeds: [new EmbedBuilder(it.payload.embed)],
        allowedMentions: { parse: (it.payload.mention === 'none' ? [] : ['everyone']) as 'everyone'[] },
      });
      log(`alert ${it.id}: sent`);
    } catch (e) {
      log(`alert ${it.id} failed:`, (e as Error).message);
      body = { status: 'error', error: humanDiscordError(e) };
    }
    try {
      await backend(`/internal/alerts/${it.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    } catch (e) {
      log('alert report failed', e);
    }
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
async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await applyConfig();
    await publishGuilds();
    await updateBindings();
    await processNews();
    await processAlerts();
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
