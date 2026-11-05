/** /help (categories as buttons) and /servers (the list of servers, a button opens the card). Both answers are private to the person who asked. */
import { CLEAR_GUIDE_FIELDS } from './clearGuide.js';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { backend, backendJson } from './backend.js';
import { followButton } from './follow.js';
import { log } from './log.js';
import { COLORS, replyEmbed } from './replies.js';
import { footerOf, getStyle } from './style.js';
import { healthColor, panelRow, stamped } from './ui.js';
import type { OnlineData } from './info.js';

export const HELP_COMMANDS = [
  { name: 'help', description: 'Что умеет бот: команды по разделам' },
  { name: 'servers', description: 'Список серверов: нажмите на сервер, чтобы увидеть его карточку' },
];
export const HELP_NAMES = new Set(HELP_COMMANDS.map((c) => c.name));

const EPHEMERAL = 64;

export interface HelpCategory { id: string; label: string; emoji: string; title: string; /** the colour of the card */ color: number; lines: [string, string][]; /** extra blocks under the list */ fields?: { name: string; value: string }[] }
export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: 'play', color: 0x57f287, label: 'Игроку', emoji: '🙋', title: 'Игроку: аккаунт и профиль',
    lines: [
      ['/register', 'создать аккаунт в панели через Discord, пароль не нужен'],
      ['/link', 'привязать игровой ник: выберите себя из списка или впишите вручную'],
      ['/nick', 'сменить игровой ник, по которому считается статистика'],
      ['/profile', 'моя карточка: ранг, часы в игре, достижения'],
      ['/roles', 'выбрать себе роли в меню: взять или снять'],
    ],
  },
  {
    id: 'srv', color: 0x3b82f6, label: 'Серверы', emoji: '🖥️', title: 'Серверы: кто и где играет',
    lines: [
      ['/online', 'сколько игроков на каждом сервере'],
      ['/servers', 'список серверов с кнопками: нажмите, чтобы открыть карточку'],
      ['/status', 'карточка сервера с графиком за сутки'],
    ],
  },
  {
    id: 'stat', color: 0x8b5cf6, label: 'Статистика', emoji: '📊', title: 'Статистика игроков',
    lines: [
      ['/player', 'карточка игрока: часы, серия дней, где и когда играет'],
      ['/top', 'самые активные игроки за неделю или месяц'],
    ],
  },
  {
    id: 'mod', color: 0xef4444, label: 'Модерация', emoji: '🛡️', title: 'Модерация (для администраторов)',
    lines: [
      ['/clear', 'очистить чат в этом канале: с подтверждением, закреплённые остаются'],
      ['/ban', 'заблокировать участника с причиной (удаляет его сообщения, пишет ему в ЛС)'],
      ['/unban', 'снять блокировку: без параметра покажет список банов с меню, с параметром подскажет имя или ID'],
      ['/kick', 'исключить участника с причиной, он сможет вернуться по приглашению'],
      ['/warn', 'вынести предупреждение: шкала ●●○○○, прошлые причины, лесенка наказаний из панели'],
      ['/mute', 'запретить писать и говорить на время (10m, 1h, 1d… до 28 дней)'],
      ['/unmute', 'снять мут досрочно'],
      ['⚠️ Предупредить', 'правый клик по участнику или сообщению → «Приложения»: окно с причиной, к варну прикрепляется ссылка на сообщение'],
    ],
    fields: CLEAR_GUIDE_FIELDS,
  },
];

const row = (...b: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(...b);

export function helpButtons(active: string | null): ActionRowBuilder<ButtonBuilder>[] {
  const rows = [
    row(
      new ButtonBuilder().setCustomId('help:home').setLabel('Главная').setEmoji('🏠').setStyle(active === null ? ButtonStyle.Success : ButtonStyle.Secondary),
      ...HELP_CATEGORIES.map((c) => new ButtonBuilder().setCustomId(`help:${c.id}`).setLabel(c.label).setEmoji(c.emoji).setStyle(c.id === active ? ButtonStyle.Primary : ButtonStyle.Secondary)),
    ),
  ];
  const panel = panelRow([{ label: '🌐 Открыть панель', path: '/' }]);
  const close = new ButtonBuilder().setCustomId('help:close').setLabel('Закрыть').setEmoji('✖️').setStyle(ButtonStyle.Danger);
  const last = panel[0];
  if (last) last.addComponents(close);
  rows.push(last ?? row(close));
  return rows;
}

/** what the first screen and «Серверы» show above the text: how many play now */
export interface Live { players: number; up: number; total: number }
export const liveOf = (d: OnlineData | null): Live | null => (d ? { players: d.players, up: d.servers.filter((s) => s.online).length, total: d.servers.length } : null);
export const liveLine = (l: Live): string => `${l.up === l.total && l.total > 0 ? '🟢' : l.up === 0 ? '🔴' : '🟡'} Сейчас играют **${l.players}** · серверов в сети **${l.up} из ${l.total}**`;

/** the first screen (category null) or one category */
export function helpEmbed(category: string | null, live: Live | null = null): EmbedBuilder {
  const cat = HELP_CATEGORIES.find((c) => c.id === category);
  if (!cat) {
    return stamped(new EmbedBuilder()
      .setTitle(live ? `📖 Что умеет бот · ${live.up}/${live.total} онлайн · ${live.players} ${live.players === 1 ? 'игрок' : 'игроков'}` : '📖 Что умеет бот')
      .setDescription('Выберите раздел кнопкой ниже: в каждом команды с коротким пояснением.\n\n' + HELP_CATEGORIES.map((c) => `${c.emoji} **${c.label}** — ${c.lines.map((l) => `\`${l[0]}\``).join(', ')}`).join('\n'))
      .setColor(live ? healthColor(live.up, live.total) : getStyle().accent)
      .setFooter(footerOf()));
  }
  const head = cat.id === 'srv' && live ? `${liveLine(live)}\n\n` : '';
  return stamped(new EmbedBuilder()
    .setTitle(`${cat.emoji} ${cat.title}`)
    .setDescription(head + cat.lines.map(([cmd, text]) => `\`${cmd}\` — ${text}`).join('\n'))
    .addFields(cat.fields ?? [])
    .setColor(cat.color)
    .setFooter(footerOf()));
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

export const backButton = (serverId?: number) => row(new ButtonBuilder().setCustomId('srv:list').setLabel('К списку').setEmoji('⬅️').setStyle(ButtonStyle.Primary), ...(serverId ? [followButton('server', serverId, '🔔 Следить')] : []));

/** the numbers for the card; empty when the panel does not answer within two seconds */
async function liveNow(): Promise<Live | null> {
  try {
    const r = await backendJson<OnlineData>('/internal/discord/online', { signal: AbortSignal.timeout(2000) });
    return liveOf(r.data);
  } catch {
    return null;
  }
}

async function serversScreen(): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files: AttachmentBuilder[] } | null> {
  const { data } = await backendJson<OnlineData>('/internal/discord/online');
  if (!data) return null;
  const up = data.servers.filter((s) => s.online).length;
  const e = new EmbedBuilder()
    .setTitle('🖥️ Серверы')
    .setDescription(data.servers.length ? `Нажмите на сервер, чтобы открыть его карточку.\nСейчас играют: **${data.players}**, в сети серверов: **${up}** из ${data.servers.length}.` : 'Серверов пока нет.')
    .setColor(healthColor(up, data.servers.length))
    .setFooter(footerOf());
  return { embeds: [stamped(e)], components: serverButtons(data.servers), files: [] };
}

export async function handleHelp(i: ChatInputCommandInteraction): Promise<void> {
  try {
    if (i.commandName === 'help') {
      // the live numbers need a short call to the panel: acknowledge first, they are in the card when it appears
      await i.deferReply({ flags: EPHEMERAL });
      const live = await liveNow();
      await i.editReply({ embeds: [helpEmbed(null, live)], components: helpButtons(null) });
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
    if (i.customId === 'help:close') {
      try {
        await i.deleteReply();
      } catch {
        await i.editReply({ content: '✖️ Закрыто', embeds: [], components: [] }).catch(() => undefined);
      }
      return;
    }
    if (i.customId.startsWith('help:')) {
      const id = i.customId.slice(5);
      const cat = id === 'home' ? null : id;
      await i.editReply({ embeds: [helpEmbed(cat, cat === null || cat === 'srv' ? await liveNow() : null)], components: helpButtons(cat) });
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
    await i.editReply({ embeds: [], files: [file], components: [backButton(id)] });
  } catch (e) {
    log(`button ${i.customId} failed:`, (e as Error).message);
  }
}
