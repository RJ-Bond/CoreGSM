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
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, EmbedBuilder, GatewayIntentBits } = await import('discord.js');
type DiscordClient = InstanceType<typeof Client>;

interface Binding {
  id: number;
  serverId: number;
  /** every server shown in this message (the main one first); one embed per server */
  serverIds?: number[];
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

/** Discord 429: how long to wait (ms), or 0 when the error is not a rate limit. */
function retryAfterOf(e: unknown): number {
  const err = e as { status?: number; retryAfter?: number; timeToReset?: number; rawError?: { retry_after?: number }; code?: number | string };
  if (err?.status !== 429 && err?.code !== 429 && err?.timeToReset === undefined) return 0;
  const sec = err.rawError?.retry_after;
  const ms = err.retryAfter ?? err.timeToReset ?? (typeof sec === 'number' ? sec * 1000 : 0);
  return Math.max(1000, Math.round(ms || 5000));
}

/** Short reason stored in the delivery log; `final` = retrying cannot help. */
function deliveryFailure(e: unknown): { text: string; final: boolean; retryAfterMs?: number } {
  const code = (e as { code?: number | string })?.code;
  const wait = retryAfterOf(e);
  if (wait) return { text: 'превышен лимит запросов Discord', final: false, retryAfterMs: wait };
  switch (code) {
    case 50007: return { text: 'пользователь закрыл ЛС', final: true };
    case 10013: return { text: 'пользователь не найден', final: true };
    case 50001:
    case 50013: return { text: 'нет прав', final: false };
    case 10003: return { text: 'канал не найден', final: false };
  }
  return { text: humanDiscordError(e).slice(0, 200), final: false };
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

/** Discord drops a second create-message with the same nonce (within a few minutes): retries are safe */
const newNonce = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 25);

/** a pooled connection that the proxy closed under us: the request never reached Discord, so one more try is safe */
const SOCKET_ERR = /other side closed|UND_ERR_SOCKET|ECONNRESET|socket hang up|EPIPE|terminated|operation was aborted|AbortError|timed out|ETIMEDOUT/i;
async function retrySocket<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const err = e as Error & { code?: string; cause?: { message?: string; code?: string } };
      const text = `${err.message} ${err.code ?? ''} ${err.cause?.message ?? ''} ${err.cause?.code ?? ''}`;
      if (i >= tries || !SOCKET_ERR.test(text)) throw e;
      log(`connection to Discord failed (${err.message}), retry ${i}/${tries - 1}`);
      await new Promise((r) => setTimeout(r, 300 * i));
    }
  }
}

// ---------- slash commands: registration of players from Discord ----------
const COMMANDS = [
  {
    name: 'register',
    description: 'Зарегистрироваться на сайте через ваш Discord: пароль не нужен',
    options: [
      { type: 3, name: 'nick', description: 'Ваш ник В ИГРЕ (V Rising), точно как в игре: по нему считаются часы и ранг', required: true, min_length: 2, max_length: 40, autocomplete: true },
      { type: 5, name: 'agree', description: 'Поставьте True, если согласны с правилами сообщества (нужно, если правила есть)', required: false },
    ],
  },
  {
    name: 'nick',
    description: 'Сменить игровой ник, по которому считается статистика',
    options: [{ type: 3, name: 'nick', description: 'Новый ник В ИГРЕ (V Rising), точно как в игре', required: true, min_length: 2, max_length: 40, autocomplete: true }],
  },
  { name: 'profile', description: 'Моя карточка: ник, ранг V Rising, часы в игре и достижения' },
];

async function registerCommands(c: DiscordClient): Promise<void> {
  try {
    const set = await c.application?.commands.set(COMMANDS as never);
    commandsCount = set ? set.size : null;
    log(`Slash commands registered: ${commandsCount}`);
  } catch (e) {
    commandsCount = 0;
    log('Slash commands registration failed:', humanDiscordError(e));
  }
  await publishStatus();
}

const EPHEMERAL = 64;
const COLORS = { ok: 0x2ecc71, warn: 0xf5b01e, bad: 0xe74c3c, info: 0x9b1c31 };

interface RegisterAnswer {
  status: 'created' | 'exists' | 'pending' | 'disabled' | 'rules' | 'conflict';
  username?: string;
  profileUrl?: string;
  rulesText?: string;
  message?: string;
}

/** a status mark in front of a plain reply title, unless the title already starts with an emoji */
const markOf = (color: number) => (color === COLORS.ok ? '✅' : color === COLORS.bad ? '❌' : color === COLORS.warn ? '⚠️' : 'ℹ️');

function replyEmbed(title: string, description: string, color: number, url?: string) {
  const lead = /^\p{Extended_Pictographic}/u.test(title) ? '' : `${markOf(color)} `;
  const e = new EmbedBuilder().setTitle(`${lead}${title}`.slice(0, 250)).setDescription(description.slice(0, 3900)).setColor(color).setFooter({ text: 'CoreGSM' });
  if (url && /^https?:\/\//.test(url)) e.setURL(url);
  return { embeds: [e] };
}

interface ProfileData {
  found: boolean;
  username: string;
  displayName: string;
  gameNick: string;
  rank: { id: string; name: string; hours: number; color: string; image: string; next: { name: string; minHours: number } | null; progress: number } | null;
  achievements: number;
  achievementsTotal?: number;
  nickSeen?: boolean;
  lastSeenAt?: number | null;
  profileUrl: string;
}

const hexToInt = (hex: string) => (/^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : COLORS.info);
const bar10 = (p: number) => {
  const n = Math.max(0, Math.min(10, Math.round(p * 10)));
  return '▰'.repeat(n) + '▱'.repeat(10 - n);
};
const hoursText = (h: number) => (Number.isInteger(h) ? `${h}` : h.toFixed(1)).replace('.', ',');

/** the player's card: Discord name and picture on top, the rank emblem as the thumbnail, link buttons below */
function cardReply(
  user: { displayAvatarURL: (o?: { size?: number }) => string },
  displayName: string,
  p: ProfileData,
  opts: { title: string; description?: string; color?: number; onboarding?: boolean },
) {
  const base = /^https?:\/\//.test(p.profileUrl) ? p.profileUrl.replace(/\/#\/profile\/?$/, '') : '';
  const color = opts.color ?? (p.rank ? hexToInt(p.rank.color) : COLORS.info);
  const e = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: displayName.slice(0, 120), iconURL: user.displayAvatarURL({ size: 64 }) })
    .setTitle(opts.title.slice(0, 250));
  if (opts.description) e.setDescription(opts.description.slice(0, 3000));
  if (base && p.rank?.image) e.setThumbnail(`${base}${p.rank.image}`);
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  fields.push({ name: '🎮 Игровой ник', value: p.gameNick ? `\`${p.gameNick}\`` : 'не задан', inline: true });
  if (p.rank) {
    fields.push({ name: '🩸 Ранг V Rising', value: `**${p.rank.name}**`, inline: true });
    fields.push({ name: '⏱️ Часов в игре', value: hoursText(p.rank.hours), inline: true });
    if (p.rank.next) {
      const left = Math.max(0, p.rank.next.minHours - p.rank.hours);
      fields.push({ name: `Следующий ранг: ${p.rank.next.name}`, value: `${bar10(p.rank.progress)}  ещё **${hoursText(left)} ч**` });
    } else {
      fields.push({ name: 'Вершина лестницы', value: 'Вы достигли высшего ранга.' });
    }
  } else if (p.gameNick) {
    fields.push({ name: '🩸 Ранг V Rising', value: 'появится после первой игры на сервере', inline: true });
  }
  fields.push({ name: '🏆 Достижений', value: p.achievementsTotal ? `${p.achievements} из ${p.achievementsTotal}` : String(p.achievements), inline: true });
  if (p.gameNick) {
    const seenLine = p.nickSeen
      ? `✅ Ник найден на сервере: последний раз ${p.lastSeenAt ? `<t:${Math.floor(p.lastSeenAt / 1000)}:R>` : 'недавно'}`
      : `⏳ Ждём ваш первый заход под ником \`${p.gameNick}\``;
    if (opts.onboarding) {
      const steps = p.nickSeen
        ? `${seenLine}\nЧасы, ранг и достижения уже считаются. Если ник неверный, исправьте его командой \`/nick\`.`
        : `Зайдите на сервер V Rising под ником \`${p.gameNick}\`. Как только панель увидит игрока, часы, ранг и достижения начнут считаться.\nЕсли ник указан неверно, исправьте его командой \`/nick\`.`;
      fields.push({ name: '👣 Что дальше', value: steps.slice(0, 1000) });
    } else {
      fields.push({ name: '📡 Связь с сервером', value: seenLine });
    }
  }
  e.addFields(fields);
  e.setFooter({ text: 'CoreGSM · статистика копится с первого входа на сервер' });

  const components = [];
  if (base) {
    components.push(
      new ActionRowBuilder<InstanceType<typeof ButtonBuilder>>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('👤 Профиль').setURL(`${base}/go/profile`),
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('🏆 Достижения').setURL(`${base}/go/profile/player`),
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('📊 Серверы').setURL(`${base}/go/servers`),
      ),
    );
  }
  return { embeds: [e], components };
}

async function backendJson<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const r = await backend(path, init);
  let data: T | null = null;
  try {
    data = (await r.json()) as T;
  } catch {
    /* not JSON */
  }
  return { ok: r.ok, status: r.status, data };
}

/** Autocomplete of the in-game nick: up to 25 names seen on the servers. Must answer within 3 s and never throws. */
async function handleAutocomplete(i: import('discord.js').AutocompleteInteraction): Promise<void> {
  let names: string[] = [];
  try {
    if ((i.commandName === 'register' || i.commandName === 'nick') && i.options.getFocused(true).name === 'nick') {
      const q = new URLSearchParams({ q: String(i.options.getFocused()).slice(0, 100), discordId: i.user.id });
      const r = await backend(`/internal/discord/nick-suggest?${q.toString()}`, { signal: AbortSignal.timeout(2000) });
      const d = (await r.json()) as { names?: unknown };
      if (Array.isArray(d.names)) names = d.names.filter((n): n is string => typeof n === 'string' && n.length > 0 && n.length <= 100).slice(0, 25);
    }
  } catch {
    names = [];
  }
  try {
    await i.respond(names.map((n) => ({ name: n, value: n })));
  } catch (e) {
    log('autocomplete failed:', (e as Error).message);
  }
}

async function handleInteraction(i: import('discord.js').Interaction): Promise<void> {
  if (i.isAutocomplete()) return handleAutocomplete(i);
  if (!i.isChatInputCommand()) return;
  const name = i.commandName;
  if (name !== 'register' && name !== 'nick' && name !== 'profile') return;
  // Discord wants an answer within 3 seconds: acknowledge first, do the work after, and log how long it took
  const t0 = Date.now();
  const age = t0 - i.createdTimestamp;
  try {
    await i.deferReply({ flags: EPHEMERAL });
    log(`/${name} from ${i.user.id}: received ${age} ms after Discord sent it, acknowledged in ${Date.now() - t0} ms`);
  } catch (e) {
    // the interaction expired (the bot was too slow or restarting) or Discord refused: the player sees «Приложение не отвечает»
    log(`/${name} from ${i.user.id}: could not acknowledge (${age} ms old):`, (e as Error).message);
    return;
  }
  const reply = async (p: ReturnType<typeof replyEmbed> | ReturnType<typeof cardReply>) => {
    try {
      await i.editReply(p);
    } catch (e) {
      log('reply failed:', (e as Error).message);
    }
  };
  const user = i.user;
  const displayName = (user.globalName || user.username || '').trim();
  const who = { discordId: user.id, displayName, avatarHash: user.avatar ?? null };
  const loadCard = async (): Promise<ProfileData | null> => {
    const q = new URLSearchParams({ discordId: user.id, displayName });
    if (user.avatar) q.set('avatarHash', user.avatar);
    const r = await backendJson<ProfileData>(`/internal/discord/profile?${q.toString()}`);
    return r.data && r.data.found ? r.data : null;
  };
  const friendly = () => reply(replyEmbed('Не получилось', 'Панель сейчас не отвечает. Попробуйте чуть позже.', COLORS.bad));
  try {
    if (name === 'register') {
      const agree = i.options.getBoolean('agree') ?? undefined;
      const { ok, status, data } = await backendJson<RegisterAnswer>('/internal/discord/register', {
        method: 'POST',
        body: JSON.stringify({ ...who, gameNick: i.options.getString('nick', true), agree }),
      });
      if (!data) return void (await friendly());
      if (!ok || !data.status) {
        const bad = status === 429 || status === 400;
        return void (await reply(replyEmbed(bad ? 'Проверьте команду' : 'Не получилось', data.message || 'Панель отклонила запрос.', COLORS.warn)));
      }
      const url = data.profileUrl;
      const link = url ? `\n\n[Открыть профиль в панели](${url})` : '';
      switch (data.status) {
        case 'created': {
          const card = await loadCard();
          if (card) {
            return void (await reply(cardReply(user, displayName, card, {
              title: '🩸 Добро пожаловать!',
              onboarding: true,
              description: `Аккаунт создан. Логин в панели: **${data.username}**.\nВходите кнопкой «Войти через Discord»: пароль не нужен.`,
              color: COLORS.ok,
            })));
          }
          return void (await reply(replyEmbed('Аккаунт создан', `Логин в панели: **${data.username}**.\nВходите кнопкой «Войти через Discord»: пароль не нужен.${link}`, COLORS.ok, url)));
        }
        case 'exists': {
          const card = await loadCard();
          if (card) {
            return void (await reply(cardReply(user, displayName, card, { title: 'Аккаунт уже есть', description: `${data.message ?? ''}`.trim(), color: COLORS.ok, onboarding: true })));
          }
          return void (await reply(replyEmbed('Аккаунт уже есть', `${data.message ?? ''}\nЛогин в панели: **${data.username}**.${link}`, COLORS.ok, url)));
        }
        case 'pending':
          return void (await reply(replyEmbed('Заявка отправлена', data.message ?? 'Дождитесь одобрения администратора.', COLORS.warn)));
        case 'disabled':
          return void (await reply(replyEmbed('Регистрация закрыта', data.message ?? 'Администратор закрыл регистрацию.', COLORS.bad)));
        case 'rules':
          return void (await reply(replyEmbed('Правила сообщества', `${data.rulesText ?? ''}\n\nЕсли согласны, повторите команду: \`/register nick:... agree:True\`.`, COLORS.info)));
        case 'conflict':
          return void (await reply(replyEmbed('Ник занят', data.message ?? 'Этот игровой ник уже занят другим аккаунтом.', COLORS.bad)));
      }
      return void (await friendly());
    }
    if (name === 'nick') {
      const { data } = await backendJson<{ status?: string; gameNick?: string }>('/internal/discord/nick', {
        method: 'POST',
        body: JSON.stringify({ ...who, gameNick: i.options.getString('nick', true) }),
      });
      if (!data) return void (await friendly());
      if (data.status === 'ok') {
        const card = await loadCard();
        if (card) return void (await reply(cardReply(user, displayName, card, { title: 'Игровой ник сохранён', description: `Онлайн, ранг и достижения на серверах V Rising теперь считаются по нику **${data.gameNick ?? card.gameNick}**.`, color: COLORS.ok, onboarding: true })));
        return void (await reply(replyEmbed('Ник сохранён', `Игровой ник: **${data.gameNick ?? ''}**. Статистика считается по нему.`, COLORS.ok)));
      }
      if (data.status === 'notfound') return void (await reply(replyEmbed('Аккаунта нет', 'Сначала зарегистрируйтесь: `/register nick:ваш_ник`.', COLORS.warn)));
      if (data.status === 'conflict') return void (await reply(replyEmbed('Ник занят', 'Этот игровой ник уже занят другим аккаунтом.', COLORS.bad)));
      return void (await reply(replyEmbed('Проверьте ник', 'Игровой ник: от 2 до 40 символов.', COLORS.warn)));
    }
    const card = await loadCard();
    if (!card) {
      return void (await reply(replyEmbed('Аккаунта нет', 'Сначала зарегистрируйтесь: `/register nick:ваш_ник_в_игре`.', COLORS.warn)));
    }
    await reply(cardReply(user, displayName, card, { title: `Профиль: ${card.username}` }));
  } catch (e) {
    log('command failed:', (e as Error).message);
    await friendly();
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
  gatewayAgent = proxy?.ws;
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
    void handleInteraction(i).catch((e) => log('interaction failed:', (e as Error).message));
  });
  client = c;
  setState('connecting');
  try {
    await c.login(cfg.discordToken);
    log(`Logged in as ${c.user?.tag}`);
    setState('online', { tag: c.user?.tag ?? null, clientId: c.user?.id ?? null });
    void registerCommands(c);
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
/** characters Discord counts towards the 6000 limit of one message (title, description, fields, footer) */
function embedChars(e: { title?: string; description?: string; fields?: { name: string; value: string }[]; footer?: { text: string }; author?: { name: string } }): number {
  return (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + (e.author?.name.length ?? 0) + (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
}

async function buildPayload(b: Binding) {
  const style = b.style ?? 'embed';
  // one message may show up to 10 servers (a Discord limit): the main server first
  const ids = [...new Set([b.serverId, ...(b.serverIds ?? [])])].slice(0, 10);
  const multi = ids.length > 1;

  type Raw = ConstructorParameters<typeof EmbedBuilder>[0] & { title?: string; description?: string; fields?: { name: string; value: string; inline?: boolean }[]; footer?: { text: string; icon_url?: string } };
  const raws: Raw[] = [];
  const files: InstanceType<typeof AttachmentBuilder>[] = [];

  for (const [i, id] of ids.entries()) {
    // the embed layout (emojis, fields, colours) is defined once in the backend and shared with the panel preview
    let raw: Raw;
    if (style === 'card') {
      raw = { color: 0x5a4bd1, timestamp: new Date().toISOString() } as Raw;
    } else {
      const r = await backend(`/internal/servers/${id}/embed?interval=${b.intervalSec}`);
      if (!r.ok) {
        // a deleted server must not break the whole message
        if (multi && r.status === 404) continue;
        throw new Error(`embed HTTP ${r.status}`);
      }
      raw = (await r.json()) as Raw;
    }
    if (style !== 'embed') {
      const img = await backend(`/internal/card/${id}.png`);
      if (!img.ok) {
        if (multi && img.status === 404) continue;
        throw new Error(`card HTTP ${img.status}`);
      }
      const name = multi ? `card-${i}.png` : 'card.png';
      files.push(new AttachmentBuilder(Buffer.from(await img.arrayBuffer()), { name }));
      (raw as { image?: { url: string } }).image = { url: `attachment://${name}` };
    }
    raws.push(raw);
  }
  if (raws.length === 0) throw new Error('Нет ни одного сервера для сообщения');

  if (multi) {
    // one footer for the whole block (on the last embed); the 6000-character limit of a message: when it is
    // exceeded drop the player lists first, from the last server backwards, then the extra fields
    // the brand line (author) only on the first embed; footer and timestamp only on the last one
    raws.forEach((r, i) => {
      if (i > 0) delete (r as { author?: unknown }).author;
      if (i < raws.length - 1) {
        delete r.footer;
        delete (r as { timestamp?: unknown }).timestamp;
      }
    });
    const total = () => raws.reduce((n, r) => n + embedChars(r), 0);
    for (let i = raws.length - 1; i >= 0 && total() > 5800; i--) {
      const f = raws[i].fields;
      if (f && f.length > 6) raws[i].fields = f.slice(0, 6);
    }
  }
  // link buttons (no interactions to handle): «Все игроки» opens the players tab of the server in the panel;
  // one button per server for up to 5 servers, the label is the server name when there are several
  const buttons: InstanceType<typeof ButtonBuilder>[] = [];
  for (const r of raws.slice(0, 5)) {
    const url = (r as { url?: string }).url;
    if (!url || !/^https?:\/\//.test(url)) continue;
    const label = multi ? `👥 ${String(r.title ?? 'Сервер').slice(0, 70)}` : '👥 Все игроки на сайте';
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(`${url.replace(/\/$/, '')}/players`));
  }
  const components = buttons.length ? [new ActionRowBuilder<InstanceType<typeof ButtonBuilder>>().addComponents(buttons)] : [];
  return { embeds: raws.map((r) => new EmbedBuilder(r)), files, components };
}

async function update(c: DiscordClient, b: Binding): Promise<void> {
  const built = await buildPayload(b);

  const channel = await retrySocket(() => c.channels.fetch(b.channelId));
  if (!channel || !channel.isTextBased() || !('send' in channel)) throw new Error('Канал не найден или не текстовый');

  const payload = () => built;

  if (b.messageId) {
    try {
      const msg = await retrySocket(() => channel.messages.fetch(b.messageId!));
      // attachments: [] drops a picture left over from a previous style
      await retrySocket(() => msg.edit({ ...payload(), attachments: [] }));
      return await report(b.id, { error: null });
    } catch (e) {
      log(`binding ${b.id}: cannot edit message, posting a new one`, (e as Error).message);
    }
  }
  const nonce = newNonce();
  const sent = await retrySocket<{ id: string }>(() => channel.send({ ...payload(), nonce, enforceNonce: true }));
  await report(b.id, { messageId: sent.id, error: null });
}

// ---------- news: messages written in the panel ----------
interface NewsEmbed {
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
}
interface NewsPayload {
  content: string;
  mention: 'none' | 'here' | 'everyone';
  embed?: NewsEmbed;
  /** more embeds in the same message (variables are already substituted by the panel) */
  extraEmbeds?: NewsEmbed[];
  /** link buttons under the message (at most 3) */
  actions?: { label: string; url: string }[];
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

async function buildNews(p: NewsPayload, statusEmbeds: Record<string, unknown>[] = []) {
  const files: InstanceType<typeof AttachmentBuilder>[] = [];
  const token = p.mention === 'everyone' ? '@everyone' : p.mention === 'here' ? '@here' : '';
  // the token is added once: not when the text already has it
  const mention = token && !(p.content ?? '').includes(token) ? token : '';
  const content = [mention, p.content?.trim()].filter(Boolean).join('\n');
  const embeds: InstanceType<typeof EmbedBuilder>[] = [];
  const attached = new Set<string>();
  for (const e of [...(p.embed ? [p.embed] : []), ...(p.extraEmbeds ?? [])].slice(0, 10)) {
    const eb = new EmbedBuilder().setColor(e.color ?? 0x5865f2);
    if (e.title) eb.setTitle(e.title);
    if (e.url) eb.setURL(e.url);
    if (e.description) eb.setDescription(e.description);
    if (e.author?.name) eb.setAuthor({ name: e.author.name, ...(e.author.iconUrl ? { iconURL: e.author.iconUrl } : {}) });
    if (e.thumbnailUrl) eb.setThumbnail(e.thumbnailUrl);
    if (e.image?.upload) {
      // a picture uploaded in the panel travels as an attachment (once, even when several embeds use it)
      if (!attached.has(e.image.upload)) {
        const r = await backend(`/api/news/images/${e.image.upload}`);
        if (!r.ok) throw new Error('Не удалось получить загруженную картинку (она могла быть удалена)');
        files.push(new AttachmentBuilder(Buffer.from(await r.arrayBuffer()), { name: e.image.upload }));
        attached.add(e.image.upload);
      }
      eb.setImage(`attachment://${e.image.upload}`);
    } else if (e.image?.url) {
      eb.setImage(e.image.url);
    }
    if (e.fields?.length) eb.addFields(e.fields.map((x) => ({ name: x.name, value: x.value, inline: !!x.inline })));
    if (e.footer?.text) eb.setFooter({ text: e.footer.text });
    if (e.timestamp) eb.setTimestamp();
    embeds.push(eb);
  }
  for (const raw of statusEmbeds) {
    if (embeds.length >= 10) break;
    embeds.push(new EmbedBuilder(raw as ConstructorParameters<typeof EmbedBuilder>[0]));
  }
  const components = (p.actions ?? []).length
    ? [
        new ActionRowBuilder<InstanceType<typeof ButtonBuilder>>().addComponents(
          (p.actions ?? []).slice(0, 3).map((a) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(a.label.slice(0, 80)).setURL(a.url)),
        ),
      ]
    : [];
  return {
    content: content || undefined,
    embeds,
    files,
    components,
    allowedMentions: { parse: (p.mention === 'none' ? [] : ['everyone']) as 'everyone'[] },
  };
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
    await processDeliveries();
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
