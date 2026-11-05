/**
 * /link: a wizard that ties the Discord account to the panel and to the in-game nick. A menu offers the names seen on the
 * servers (the person just picks theirs), or the nick is typed in a window. With no account yet it registers one (asking for
 * the rules first when the community has them), with an account it changes the nick.
 */
import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction, type User } from 'discord.js';
import { backend, backendJson } from './backend.js';
import { log } from './log.js';
import { COLORS, cardReply, replyEmbed, type ProfileData } from './replies.js';
import { agreeId, cleanNick, nickOptions, parseLink } from './linkLogic.js';
import { footerOf, getStyle } from './style.js';
import { panelRow, stamped } from './ui.js';

export const LINK_COMMANDS = [{ name: 'link', description: 'Привязать игровой ник: выберите себя из списка игроков' }];
export const LINK_NAMES = new Set(LINK_COMMANDS.map((c) => c.name));

const EPHEMERAL = 64;

type Reply = Parameters<ChatInputCommandInteraction['editReply']>[0];

const who = (u: User) => ({ discordId: u.id, displayName: (u.globalName || u.username || '').trim(), avatarHash: u.avatar ?? null });

async function loadCard(u: User): Promise<ProfileData | null> {
  const w = who(u);
  const q = new URLSearchParams({ discordId: w.discordId, displayName: w.displayName });
  if (w.avatarHash) q.set('avatarHash', w.avatarHash);
  const r = await backendJson<ProfileData>(`/internal/discord/profile?${q.toString()}`);
  return r.data && r.data.found ? r.data : null;
}

async function suggestions(u: User): Promise<{ label: string; value: string }[]> {
  try {
    const q = new URLSearchParams({ q: '', discordId: u.id });
    const r = await backend(`/internal/discord/nick-suggest?${q.toString()}`, { signal: AbortSignal.timeout(2500) });
    const d = (await r.json()) as { names?: unknown };
    return nickOptions(d.names);
  } catch {
    return [];
  }
}

/** the first screen: where the person is now and what to press */
async function startScreen(u: User): Promise<Reply> {
  const [card, options] = await Promise.all([loadCard(u).catch(() => null), suggestions(u)]);
  const has = !!card?.gameNick;
  const e = new EmbedBuilder()
    .setTitle(has ? '🔗 Игровой ник' : '🔗 Привязка аккаунта')
    .setColor(has ? (card?.nickSeen ? COLORS.ok : COLORS.warn) : getStyle().accent)
    .setDescription(
      has
        ? `Сейчас ник: **${card!.gameNick}** ${card!.nickSeen ? '✅ найден на сервере' : '⏳ ждём первый заход на сервер'}.\nЧтобы сменить, выберите другой в меню или впишите вручную.`
        : 'Выберите себя из списка игроков, которых панель видела на серверах: по нику считаются часы, ранг и достижения.\nНе нашли себя? Нажмите «Ввести ник вручную».',
    )
    .addFields({ name: 'Шаги', value: card ? '1. Выберите ник\n2. Зайдите в игру, если ещё не заходили\n3. Откройте профиль в панели' : '1. Выберите ник\n2. Аккаунт в панели создастся сам\n3. Входите кнопкой «Войти через Discord»: пароль не нужен' })
    .setFooter(footerOf());
  const rows: unknown[] = [];
  if (options.length) {
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('lnk:pick').setPlaceholder('Выберите свой ник из списка').addOptions(options)));
  }
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('lnk:manual').setLabel('Ввести ник вручную').setEmoji('✍️').setStyle(ButtonStyle.Primary)));
  return { embeds: [stamped(e)], components: [...rows, ...panelRow([{ label: '🌐 Панель', path: '/' }])] as never };
}

export async function handleLinkCommand(i: ChatInputCommandInteraction): Promise<void> {
  try {
    await i.deferReply({ flags: EPHEMERAL });
    await i.editReply(await startScreen(i.user));
  } catch (e) {
    log('/link failed:', (e as Error).message);
    await i.editReply(replyEmbed('Не получилось', 'Панель сейчас не отвечает. Попробуйте чуть позже.', COLORS.bad)).catch(() => undefined);
  }
}

interface RegisterAnswer { status?: 'created' | 'exists' | 'pending' | 'disabled' | 'rules' | 'conflict'; username?: string; profileUrl?: string; rulesText?: string; message?: string }

/** an answer that replaces the whole message: the menu and the buttons of the previous screen go away */
const shown = (r: Reply): Reply => ({ components: [], ...(r as object) }) as Reply;

/** saves the nick (registers when there is no account yet) and returns what to show */
async function apply(u: User, nick: string, agree: boolean): Promise<Reply> {
  const w = who(u);
  const card = await loadCard(u).catch(() => null);
  const friendly = replyEmbed('Не получилось', 'Панель сейчас не отвечает. Попробуйте чуть позже.', COLORS.bad);
  if (card) {
    const { data } = await backendJson<{ status?: string; gameNick?: string }>('/internal/discord/nick', { method: 'POST', body: JSON.stringify({ ...w, gameNick: nick }) });
    if (!data) return friendly;
    if (data.status === 'conflict') return replyEmbed('Ник занят', 'Этот игровой ник уже занят другим аккаунтом.', COLORS.bad);
    if (data.status !== 'ok') return replyEmbed('Проверьте ник', 'Игровой ник: от 2 до 40 символов.', COLORS.warn);
    const fresh = await loadCard(u).catch(() => null);
    return fresh ? cardReply(u, w.displayName, fresh, { title: '🔗 Ник привязан', description: `Часы, ранг и достижения считаются по нику **${data.gameNick ?? fresh.gameNick}**.`, color: COLORS.ok, onboarding: true }) : replyEmbed('Ник сохранён', `Игровой ник: **${data.gameNick ?? nick}**.`, COLORS.ok);
  }
  const { ok, data } = await backendJson<RegisterAnswer>('/internal/discord/register', { method: 'POST', body: JSON.stringify({ ...w, gameNick: nick, agree: agree || undefined }) });
  if (!data) return friendly;
  if (!ok || !data.status) return replyEmbed('Проверьте ник', data.message || 'Панель отклонила запрос.', COLORS.warn);
  switch (data.status) {
    case 'created':
    case 'exists': {
      const fresh = await loadCard(u).catch(() => null);
      if (fresh) return cardReply(u, w.displayName, fresh, { title: data.status === 'created' ? '🩸 Добро пожаловать!' : 'Аккаунт уже есть', description: data.status === 'created' ? `Аккаунт создан. Логин в панели: **${data.username}**.\nВходите кнопкой «Войти через Discord»: пароль не нужен.` : data.message ?? '', color: COLORS.ok, onboarding: true });
      return replyEmbed('Аккаунт готов', `Логин в панели: **${data.username ?? ''}**.`, COLORS.ok, data.profileUrl);
    }
    case 'pending':
      return replyEmbed('Заявка отправлена', data.message ?? 'Дождитесь одобрения администратора.', COLORS.warn);
    case 'disabled':
      return replyEmbed('Регистрация закрыта', data.message ?? 'Администратор закрыл регистрацию.', COLORS.bad);
    case 'conflict':
      return replyEmbed('Ник занят', data.message ?? 'Этот игровой ник уже занят другим аккаунтом.', COLORS.bad);
    case 'rules': {
      const out = replyEmbed('Правила сообщества', `${data.rulesText ?? ''}\n\nЕсли согласны, нажмите кнопку ниже.`.slice(0, 3900), COLORS.info);
      return { ...out, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(agreeId(nick)).setLabel('Согласен с правилами').setEmoji('✅').setStyle(ButtonStyle.Success))] };
    }
  }
  return friendly;
}

export async function handleLinkSelect(i: StringSelectMenuInteraction): Promise<void> {
  if (parseLink(i.customId)?.kind !== 'pick') return;
  const nick = cleanNick(i.values[0] ?? '');
  try {
    await i.deferUpdate();
    if (!nick) return void (await i.editReply(replyEmbed('Проверьте ник', 'Игровой ник: от 2 до 40 символов.', COLORS.warn)));
    await i.editReply(shown(await apply(i.user, nick, false)));
  } catch (e) {
    log('/link select failed:', (e as Error).message);
  }
}

export async function handleLinkButton(i: ButtonInteraction): Promise<void> {
  const a = parseLink(i.customId);
  if (!a) return;
  try {
    if (a.kind === 'manual') {
      await i.showModal(
        new ModalBuilder()
          .setCustomId('lnk:modal')
          .setTitle('Игровой ник')
          .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('nick').setLabel('Ник в игре, точно как в игре').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(2).setMaxLength(40))),
      );
      return;
    }
    if (a.kind === 'agree') {
      await i.deferUpdate();
      await i.editReply(shown(await apply(i.user, a.nick, true)));
    }
  } catch (e) {
    log('/link button failed:', (e as Error).message);
  }
}

export async function handleLinkModal(i: ModalSubmitInteraction): Promise<void> {
  if (parseLink(i.customId)?.kind !== 'modal') return;
  try {
    await i.deferReply({ flags: EPHEMERAL });
    const nick = cleanNick(i.fields.getTextInputValue('nick'));
    await i.editReply(nick ? ((await apply(i.user, nick, false)) as never) : replyEmbed('Проверьте ник', 'Игровой ник: от 2 до 40 символов.', COLORS.warn));
  } catch (e) {
    log('/link modal failed:', (e as Error).message);
  }
}
