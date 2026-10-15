/** Slash commands: registration of players from Discord (/register, /nick, /profile) and the nick autocomplete. */
import type { AutocompleteInteraction, Client, Interaction } from 'discord.js';
import { backend, backendJson } from './backend.js';
import { humanDiscordError } from './errors.js';
import { log } from './log.js';
import { COLORS, cardReply, replyEmbed, type ProfileData } from './replies.js';

export const COMMANDS = [
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

/** registers the commands and returns how many Discord accepted (0 on failure) */
export async function registerCommands(c: Client): Promise<number | null> {
  try {
    const set = await c.application?.commands.set(COMMANDS as never);
    const n = set ? set.size : null;
    log(`Slash commands registered: ${n}`);
    return n;
  } catch (e) {
    log('Slash commands registration failed:', humanDiscordError(e));
    return 0;
  }
}

const EPHEMERAL = 64;

interface RegisterAnswer {
  status: 'created' | 'exists' | 'pending' | 'disabled' | 'rules' | 'conflict';
  username?: string;
  profileUrl?: string;
  rulesText?: string;
  message?: string;
}

/** Autocomplete of the in-game nick: up to 25 names seen on the servers. Must answer within 3 s and never throws. */
async function handleAutocomplete(i: AutocompleteInteraction): Promise<void> {
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

export async function handleInteraction(i: Interaction): Promise<void> {
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
