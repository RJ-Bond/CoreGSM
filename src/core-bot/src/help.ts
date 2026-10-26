/** /help (categories as buttons) and /servers (the list of servers, a button opens the card). Both answers are private to the person who asked. */
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { backend, backendJson } from './backend.js';
import { log } from './log.js';
import { COLORS, replyEmbed } from './replies.js';
import { footerOf, getStyle } from './style.js';
import type { OnlineData } from './info.js';

export const HELP_COMMANDS = [
  { name: 'help', description: 'Что умеет бот: команды по разделам' },
  { name: 'servers', description: 'Список серверов: нажмите на сервер, чтобы увидеть его карточку' },
];
export const HELP_NAMES = new Set(HELP_COMMANDS.map((c) => c.name));

const EPHEMERAL = 64;

export interface HelpCategory { id: string; label: string; emoji: string; title: string; lines: [string, string][] }
export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: 'play', label: 'Игроку', emoji: '🙋', title: 'Игроку: аккаунт и профиль',
    lines: [
      ['/register', 'создать аккаунт в панели через Discord, пароль не нужен'],
      ['/nick', 'сменить игровой ник, по которому считается статистика'],
      ['/profile', 'моя карточка: ранг, часы в игре, достижения'],
    ],
  },
  {
    id: 'srv', label: 'Серверы', emoji: '🖥️', title: 'Серверы: кто и где играет',
    lines: [
      ['/online', 'сколько игроков на каждом сервере'],
      ['/servers', 'список серверов с кнопками: нажмите, чтобы открыть карточку'],
      ['/status', 'карточка сервера с графиком за сутки'],
    ],
  },
  {
    id: 'stat', label: 'Статистика', emoji: '📊', title: 'Статистика игроков',
    lines: [
      ['/player', 'карточка игрока: часы, серия дней, где и когда играет'],
      ['/top', 'самые активные игроки за неделю или месяц'],
    ],
  },
];

const row = (...b: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(...b);

export function helpButtons(active: string | null): ActionRowBuilder<ButtonBuilder>[] {
  return [row(...HELP_CATEGORIES.map((c) => new ButtonBuilder().setCustomId(`help:${c.id}`).setLabel(c.label).setEmoji(c.emoji).setStyle(c.id === active ? ButtonStyle.Primary : ButtonStyle.Secondary)))];
}

/** the first screen (category null) or one category */
export function helpEmbed(category: string | null): EmbedBuilder {
  const cat = HELP_CATEGORIES.find((c) => c.id === category);
  if (!cat) {
    return new EmbedBuilder()
      .setTitle('📖 Что умеет бот')
      .setDescription('Выберите раздел кнопкой ниже: в каждом команды с коротким пояснением.\n\n' + HELP_CATEGORIES.map((c) => `${c.emoji} **${c.label}** — ${c.lines.map((l) => `\`${l[0]}\``).join(', ')}`).join('\n'))
      .setColor(getStyle().accent)
      .setFooter(footerOf());
  }
  return new EmbedBuilder()
    .setTitle(`${cat.emoji} ${cat.title}`)
    .setDescription(cat.lines.map(([cmd, text]) => `\`${cmd}\` — ${text}`).join('\n'))
    .setColor(getStyle().accent)
    .setFooter(footerOf());
}

/** buttons under /servers: one per server (Discord allows 25), «srv:<id>» */
export function serverButtons(servers: OnlineData['servers']): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const list = servers.slice(0, 20);
  for (let i = 0; i < list.length; i += 5) {
    rows.push(row(...list.slice(i, i + 5).map((s) => new ButtonBuilder().setCustomId(`srv:${s.id}`).setLabel(s.name.slice(0, 40) || `#${s.id}`).setEmoji(s.online ? '🟢' : '🔴').setStyle(ButtonStyle.Secondary))));
  }
  return rows;
}

export const backButton = () => row(new ButtonBuilder().setCustomId('srv:list').setLabel('К списку').setEmoji('⬅️').setStyle(ButtonStyle.Primary));

async function serversScreen(): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files: AttachmentBuilder[] } | null> {
  const { data } = await backendJson<OnlineData>('/internal/discord/online');
  if (!data) return null;
  const up = data.servers.filter((s) => s.online).length;
  const e = new EmbedBuilder()
    .setTitle('🖥️ Серверы')
    .setDescription(data.servers.length ? `Нажмите на сервер, чтобы открыть его карточку.\nСейчас играют: **${data.players}**, в сети серверов: **${up}** из ${data.servers.length}.` : 'Серверов пока нет.')
    .setColor(getStyle().accent)
    .setFooter(footerOf());
  return { embeds: [e], components: serverButtons(data.servers), files: [] };
}

export async function handleHelp(i: ChatInputCommandInteraction): Promise<void> {
  try {
    if (i.commandName === 'help') {
      await i.reply({ embeds: [helpEmbed(null)], components: helpButtons(null), flags: EPHEMERAL });
      return;
    }
    await i.deferReply({ flags: EPHEMERAL });
    const s = await serversScreen();
    await i.editReply(s ?? replyEmbed('Не получилось', 'Панель сейчас не отвечает. Попробуйте чуть позже.', COLORS.bad));
  } catch (e) {
    log(`/${i.commandName} failed:`, (e as Error).message);
  }
}

/** a button of /help («help:<category>») or /servers («srv:list», «srv:<id>») */
export async function handleHelpButton(i: ButtonInteraction): Promise<void> {
  try {
    await i.deferUpdate();
  } catch (e) {
    log(`button ${i.customId}: could not acknowledge:`, (e as Error).message);
    return;
  }
  try {
    if (i.customId.startsWith('help:')) {
      const id = i.customId.slice(5);
      await i.editReply({ embeds: [helpEmbed(id)], components: helpButtons(id) });
      return;
    }
    if (i.customId === 'srv:list') {
      const s = await serversScreen();
      await i.editReply(s ? { ...s, attachments: [] } : { ...replyEmbed('Не получилось', 'Панель сейчас не отвечает. Попробуйте чуть позже.', COLORS.bad), components: [backButton()] });
      return;
    }
    const id = Number(i.customId.slice(4));
    if (!Number.isInteger(id) || id <= 0) return;
    const r = await backend(`/internal/card/${id}.png`);
    if (!r.ok) {
      await i.editReply({ ...replyEmbed(r.status === 404 ? 'Сервер не найден' : 'Не получилось', r.status === 404 ? 'Возможно, его удалили. Вернитесь к списку.' : 'Панель сейчас не отвечает. Попробуйте чуть позже.', COLORS.warn), components: [backButton()], attachments: [] });
      return;
    }
    const file = new AttachmentBuilder(Buffer.from(await r.arrayBuffer()), { name: `server-${id}.png` });
    await i.editReply({ embeds: [], files: [file], components: [backButton()] });
  } catch (e) {
    log(`button ${i.customId} failed:`, (e as Error).message);
  }
}
