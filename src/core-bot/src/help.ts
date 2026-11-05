/**
 * /help: a menu of sections (the language of the person, the moderation for administrators only), the details of one command
 * (`/help command:ban`), quick actions, «What's new»; and /servers (the list of servers, a button opens the card).
 * Both answers are private to the person who asked.
 */
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, StringSelectMenuBuilder, type AutocompleteInteraction, type ButtonInteraction, type ChatInputCommandInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { backend, backendJson } from './backend.js';
import { CLEAR_GUIDE_FIELDS, CLEAR_GUIDE_FIELDS_EN } from './clearGuide.js';
import { followButton } from './follow.js';
import { BLURB, CATEGORIES, CMDS, categoryOf, cmdInfo, langOf, liveLine, meLine, shortItem, shortText, suggestCommands, tx, visibleCategories, type Category, type ChangelogAnswer, type CmdInfo, type Lang, type Live, type MeLike } from './helpData.js';
import { log } from './log.js';
import { COLORS, replyEmbed } from './replies.js';
import { footerOf, getStyle } from './style.js';
import { healthColor, panelRow, stamped } from './ui.js';
import { onlineEmbed, topEmbed, type OnlineData, type TopData } from './info.js';
import { serverLine } from './dashboardLogic.js';
import { startScreen } from './link.js';

export const HELP_COMMANDS = [
  {
    name: 'help',
    description: 'Что умеет бот: команды по разделам',
    description_localizations: { ru: 'Что умеет бот: команды по разделам', 'en-US': 'What the bot can do: commands by section', 'en-GB': 'What the bot can do: commands by section' },
    options: [
      {
        type: 3,
        name: 'command',
        description: 'Подробно об одной команде',
        description_localizations: { ru: 'Подробно об одной команде', 'en-US': 'Details of one command', 'en-GB': 'Details of one command' },
        required: false,
        autocomplete: true,
      },
    ],
  },
  {
    name: 'servers',
    description: 'Список серверов: нажмите на сервер, чтобы увидеть его карточку',
    description_localizations: { ru: 'Список серверов: нажмите на сервер, чтобы увидеть его карточку', 'en-US': 'The servers: press one to see its card', 'en-GB': 'The servers: press one to see its card' },
  },
];
export const HELP_NAMES = new Set(HELP_COMMANDS.map((c) => c.name));

const EPHEMERAL = 64;
const row = (...b: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(...b);

/** who is asking and what the card may show */
export interface HelpCtx {
  lang: Lang;
  /** an administrator of the Discord server */
  admin: boolean;
  live: Live | null;
  me: MeLike | null;
  supportUrl: string | null;
  /** «What's new» text, loaded only for that section */
  news?: ChangelogAnswer | null;
}

export const liveOf = (d: OnlineData | null): Live | null => (d ? { players: d.players, up: d.servers.filter((s) => s.online).length, total: d.servers.length, servers: d.servers } : null);

// ---------- the cards ----------
const lineOf = (c: CmdInfo, lang: Lang) => `▸ \`${c.cmd}\` — ${shortText(c.text[lang])}`;
/** the logo as a big picture only on the first screen: beside a list it squeezes the text into a narrow column */
const brand = (e: EmbedBuilder, thumb = false): EmbedBuilder => {
  const logo = getStyle().logoUrl;
  if (thumb && logo) e.setThumbnail(logo);
  return stamped(e.setFooter(footerOf()));
};

/** the first screen (category null) or one section */
export function helpEmbed(category: string | null, ctx: HelpCtx): EmbedBuilder {
  const { lang } = ctx;
  const cat = CATEGORIES.find((c) => c.id === category);
  if (!cat || (cat.admin && !ctx.admin)) {
    const status = [ctx.live ? liveLine(ctx.live, lang) : '', meLine(ctx.me, lang)].filter(Boolean).join('\n');
    const list = visibleCategories(ctx.admin).filter((c) => c.id !== 'modclr').map((c) => `${c.emoji} **${c.label[lang]}** — ${BLURB[c.id]?.[lang] ?? ''}`).join('\n');
    return brand(new EmbedBuilder().setTitle(tx('title', lang)).setDescription(`${status ? `${status}\n\n` : ''}${tx('intro', lang)}\n\n${list}`).setColor(ctx.live ? healthColor(ctx.live.up, ctx.live.total) : getStyle().accent), true);
  }
  const e = new EmbedBuilder().setTitle(`${cat.emoji} ${cat.title[lang]}`).setColor(cat.color);
  if (cat.id === 'modclr') return brand(e.addFields(lang === 'en' ? CLEAR_GUIDE_FIELDS_EN : CLEAR_GUIDE_FIELDS));
  if (cat.id === 'news') {
    const n = ctx.news;
    const lines = n?.items.map((x) => `• ${x}`).join('\n');
    if (n?.version) e.setTitle(`${cat.emoji} ${cat.title[lang]} · v${n.version}`);
    return brand(e.setDescription(lines ? lines.slice(0, 3900) : tx('noNews', lang)));
  }
  const lines = cat.cmds.map((c) => cmdInfo(c)).filter((c): c is CmdInfo => !!c).map((c) => lineOf(c, lang));
  for (const x of cat.extra ?? []) lines.push(`▸ \`${x.cmd}\` — ${shortText(x.text[lang])}`);
  let head = ctx.live ? `${liveLine(ctx.live, lang)}\n` : '';
  if (cat.id === 'srv' && ctx.live) {
    const list = (ctx.live.servers ?? []).slice(0, 8).map(serverLine).join('\n');
    head += list ? `${list}\n` : '';
    e.setColor(healthColor(ctx.live.up, ctx.live.total));
  }
  return brand(e.setDescription(`${head}${head ? '\n' : ''}${lines.join('\n')}`));
}

/** the details of one command */
export function commandEmbed(c: CmdInfo, lang: Lang): EmbedBuilder {
  const cat = categoryOf(c.cmd);
  const e = new EmbedBuilder()
    .setTitle(`${cat?.emoji ?? '📖'} ${c.cmd}`)
    .setDescription(c.text[lang].charAt(0).toUpperCase() + c.text[lang].slice(1))
    .setColor(cat?.color ?? getStyle().accent)
    .addFields(
      { name: tx('usage', lang), value: `\`${c.usage}\`` },
      { name: tx('examples', lang), value: c.examples.map((x) => `\`${x}\``).join('\n') },
      { name: tx('needs', lang), value: c.needs[lang] },
    );
  if (cat) e.addFields({ name: tx('section', lang), value: `${cat.emoji} ${cat.label[lang]}`, inline: true });
  return brand(e);
}

// ---------- the controls ----------
/** the buttons that belong to one section (a second row under the menu) */
function sectionButtons(active: string, ctx: Pick<HelpCtx, 'lang' | 'admin'>): ButtonBuilder[] {
  const { lang } = ctx;
  if (active === 'play') return [new ButtonBuilder().setCustomId('help:act:link').setLabel(tx('linkNick', lang)).setEmoji('🔗').setStyle(ButtonStyle.Success)];
  if (active === 'stat') return [
    new ButtonBuilder().setCustomId('help:act:top').setLabel(tx('topWeek', lang)).setEmoji('🏆').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('help:act:topm').setLabel(tx('topMonth', lang)).setEmoji('🏅').setStyle(ButtonStyle.Secondary),
  ];
  if (active === 'mod' && ctx.admin) return [new ButtonBuilder().setCustomId('help:act:cases').setLabel(tx('cases', lang)).setEmoji('📋').setStyle(ButtonStyle.Secondary)];
  return [];
}

/** the menu of sections, the buttons of the section and the navigation row under a card */
export function helpComponents(active: string, ctx: Pick<HelpCtx, 'lang' | 'admin' | 'supportUrl'> & { live?: Live | null }): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const { lang } = ctx;
  const menu = new StringSelectMenuBuilder()
    .setCustomId('help:pick')
    .setPlaceholder(tx('placeholder', lang))
    .addOptions(
      { label: tx('home', lang), value: 'home', emoji: '🏠', description: tx('homeDesc', lang), default: active === 'home' },
      ...visibleCategories(ctx.admin).map((c) => ({ label: c.label[lang], value: c.id, emoji: c.emoji, description: (BLURB[c.id]?.[lang] ?? '').slice(0, 100), default: active === c.id })),
    );
  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
  // «Servers»: a menu with the servers, a pick opens the card
  const servers = (ctx.live?.servers ?? []).slice(0, 25);
  if (active === 'srv' && servers.length) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId('help:card').setPlaceholder(tx('openCard', lang)).addOptions(servers.map((s) => ({ label: (s.name || `#${s.id}`).slice(0, 100), value: String(s.id), emoji: s.online ? '🟢' : '🔴' }))),
      ),
    );
  }
  // a menu with the commands of the section: a pick shows the details of the command
  const here = CATEGORIES.find((c) => c.id === active);
  const names = (here?.cmds ?? []).map((c) => cmdInfo(c)).filter((c): c is CmdInfo => !!c).slice(0, 25);
  if (names.length) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`help:cmd:${active}`).setPlaceholder(tx('askCmd', lang)).addOptions(names.map((c) => ({ label: c.cmd, value: c.cmd, description: shortText(c.text[lang], 90) }))),
      ),
    );
  }
  const extra = sectionButtons(active, ctx);
  if (extra.length) rows.push(row(...extra));
  const nav: ButtonBuilder[] =
    active === 'home'
      ? [
          new ButtonBuilder().setCustomId('help:act:online').setLabel(tx('online', lang)).setEmoji('📡').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('help:act:top').setLabel(tx('top', lang)).setEmoji('🏆').setStyle(ButtonStyle.Primary),
        ]
      : [new ButtonBuilder().setCustomId('help:home').setLabel(`‹ ${tx('back', lang)}`).setStyle(ButtonStyle.Primary)];
  const links = panelRow([{ label: `🌐 ${tx('panel', lang)}`, path: '/' }])[0];
  if (links) nav.push(...(links.components as ButtonBuilder[]));
  if (ctx.supportUrl) nav.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`💬 ${tx('support', lang)}`).setURL(ctx.supportUrl));
  // a plain word: the dark cross emoji is almost invisible on a grey button
  nav.push(new ButtonBuilder().setCustomId('help:close').setLabel(tx('close', lang)).setStyle(ButtonStyle.Secondary));
  rows.push(row(...nav.slice(0, 5)));
  return rows;
}

export const helpView = (category: string | null, ctx: HelpCtx) => {
  const cat = CATEGORIES.find((c) => c.id === category);
  const shown = !cat || (cat.admin && !ctx.admin) ? 'home' : cat.id;
  return { embeds: [helpEmbed(shown === 'home' ? null : shown, ctx)], components: helpComponents(shown, ctx), content: '' };
};

// ---------- data ----------
const isAdminOf = (i: { memberPermissions?: { has: (p: bigint) => boolean } | null }): boolean => !!i.memberPermissions?.has(PermissionFlagsBits.Administrator);

async function liveNow(): Promise<Live | null> {
  try {
    return liveOf((await backendJson<OnlineData>('/internal/discord/online', { signal: AbortSignal.timeout(2000) })).data);
  } catch {
    return null;
  }
}

async function meNow(userId: string, name: string): Promise<MeLike | null> {
  try {
    const q = new URLSearchParams({ discordId: userId, displayName: name });
    const r = await backendJson<MeLike & { found: boolean }>(`/internal/discord/profile?${q.toString()}`, { signal: AbortSignal.timeout(2000) });
    return r.data;
  } catch {
    return null;
  }
}

async function newsNow(lang: Lang): Promise<ChangelogAnswer | null> {
  try {
    const r = await backendJson<ChangelogAnswer>(`/internal/changelog?lang=${lang}`, { signal: AbortSignal.timeout(3000) });
    return r.data ? { ...r.data, items: r.data.items.map((x) => shortItem(x)) } : null;
  } catch {
    return null;
  }
}

type Asker = { locale: string; user: { id: string; globalName?: string | null; username: string }; memberPermissions?: { has: (p: bigint) => boolean } | null };

/** everything a card of the given section needs; the slow parts are asked for only where they are shown */
async function ctxFor(i: Asker, category: string | null): Promise<HelpCtx> {
  const lang = langOf(i.locale);
  const home = category === null || category === 'home';
  const [live, me, news] = await Promise.all([
    home || (category !== null && !['none', 'news', 'modclr'].includes(category)) ? liveNow() : Promise.resolve(null),
    home ? meNow(i.user.id, (i.user.globalName || i.user.username || '').trim()) : Promise.resolve(null),
    category === 'news' ? newsNow(lang) : Promise.resolve(undefined),
  ]);
  return { lang, admin: isAdminOf(i), live, me, supportUrl: getStyle().supportUrl, ...(news !== undefined ? { news } : {}) };
}

// ---------- /servers ----------
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

/** the picture card of a server with the buttons «back» and «follow» */
async function serverCardReply(id: number) {
  const r = await backend(`/internal/card/${id}.png`);
  if (!r.ok) {
    return { ...replyEmbed(r.status === 404 ? 'Сервер не найден' : 'Не получилось', r.status === 404 ? 'Возможно, его удалили. Вернитесь к списку.' : 'Панель сейчас не отвечает. Попробуйте чуть позже.', COLORS.warn), components: [backButton()], attachments: [] as never[] };
  }
  const file = new AttachmentBuilder(Buffer.from(await r.arrayBuffer()), { name: `server-${id}.png` });
  return { embeds: [] as EmbedBuilder[], files: [file], components: [backButton(id)] };
}

interface CaseRow { kind: string; userName: string; modName: string; reason: string; at: number }
const CASE_EMOJI: Record<string, string> = { warn: '⚠️', ban: '🔨', unban: '🔓', kick: '👢', timeout: '🔇', unmute: '🔊', appeal: '📨' };

/** «Latest punishments» for the administrators */
async function casesReply(i: { guildId?: string | null }, ctx: HelpCtx) {
  const { lang } = ctx;
  const q = new URLSearchParams({ limit: '8', ...(i.guildId ? { guildId: i.guildId } : {}) });
  const { data } = await backendJson<{ cases: CaseRow[] }>(`/internal/discord/cases?${q.toString()}`);
  const lines = (data?.cases ?? []).map((c) => `${CASE_EMOJI[c.kind] ?? '•'} **${c.userName || '?'}** — ${(c.reason || '—').slice(0, 80)} · <t:${Math.floor(c.at / 1000)}:R>`);
  const e = new EmbedBuilder().setTitle(tx('casesTitle', lang)).setColor(0xef4444).setDescription(data ? lines.join('\n') || tx('noCases', lang) : tx('panelDown', lang));
  return { embeds: [stamped(e.setFooter(footerOf()))], components: helpComponents('mod', ctx) as never };
}

// ---------- handlers ----------
export async function handleHelp(i: ChatInputCommandInteraction): Promise<void> {
  try {
    await i.deferReply({ flags: EPHEMERAL });
    if (i.commandName === 'help') {
      const asked = i.options.getString('command');
      const lang = langOf(i.locale);
      if (asked) {
        const c = cmdInfo(asked);
        const allowed = c && visibleCategories(isAdminOf(i)).some((x) => x.cmds.includes(c.cmd));
        if (!c || !allowed) {
          await i.editReply(replyEmbed(tx('title', lang), tx('noCommand', lang), COLORS.warn));
          return;
        }
        const ctx = await ctxFor(i, 'none');
        await i.editReply({ embeds: [commandEmbed(c, lang)], components: helpComponents(categoryOf(c.cmd)?.id ?? 'home', ctx) as never });
        return;
      }
      await i.editReply(helpView(null, await ctxFor(i, null)) as never);
      return;
    }
    const s = await serversScreen();
    await i.editReply(s ?? replyEmbed('Не получилось', 'Панель сейчас не отвечает. Попробуйте чуть позже.', COLORS.bad));
  } catch (e) {
    log(`/${i.commandName} failed:`, (e as Error).message);
  }
}

/** autocomplete of `/help command:` */
export async function helpAutocomplete(i: AutocompleteInteraction): Promise<void> {
  try {
    await i.respond(suggestCommands(String(i.options.getFocused()), isAdminOf(i), langOf(i.locale)));
  } catch (e) {
    log('help autocomplete failed:', (e as Error).message);
  }
}

const staleNotice = async (i: ButtonInteraction | StringSelectMenuInteraction): Promise<void> => {
  await i.followUp({ content: tx('stale', langOf(i.locale)), flags: EPHEMERAL }).catch(() => undefined);
};

/** the menu «help:pick» */
export async function handleHelpSelect(i: StringSelectMenuInteraction): Promise<void> {
  try {
    await i.deferUpdate();
  } catch (e) {
    log(`help menu: could not acknowledge:`, (e as Error).message);
    return;
  }
  try {
    const id = i.values[0] ?? 'home';
    if (i.customId.startsWith('help:cmd:')) {
      const info = cmdInfo(id);
      const section = i.customId.slice('help:cmd:'.length);
      const lang = langOf(i.locale);
      if (info) {
        const back = new ButtonBuilder().setCustomId(`help:back:${section}`).setLabel(`‹ ${tx('back', lang)}`).setStyle(ButtonStyle.Primary);
        await i.editReply({ embeds: [commandEmbed(info, lang)], components: [row(back)] } as never);
      }
      return;
    }
    if (i.customId === 'help:card') {
      const n = Number(id);
      if (Number.isInteger(n) && n > 0) await i.editReply((await serverCardReply(n)) as never);
      return;
    }
    await i.editReply(helpView(id === 'home' ? null : id, await ctxFor(i, id)) as never);
  } catch (e) {
    log('help menu failed:', (e as Error).message);
    await staleNotice(i);
  }
}

/** a button of /help («help:home», «help:close», «help:act:*») or /servers («srv:list», «srv:<id>») */
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
        await i.editReply({ content: tx('closed', langOf(i.locale)), embeds: [], components: [] }).catch(() => undefined);
      }
      return;
    }
    if (i.customId === 'help:home') {
      await i.editReply(helpView(null, await ctxFor(i, null)) as never);
      return;
    }
    if (i.customId.startsWith('help:back:')) {
      const section = i.customId.slice('help:back:'.length);
      await i.editReply(helpView(section, await ctxFor(i, section)) as never);
      return;
    }
    if (i.customId === 'help:act:link') {
      await i.editReply((await startScreen(i.user)) as never);
      return;
    }
    if (i.customId === 'help:act:cases') {
      const ctx = await ctxFor(i, 'none');
      if (!ctx.admin) return void (await i.editReply(helpView(null, await ctxFor(i, null)) as never));
      await i.editReply((await casesReply(i, ctx)) as never);
      return;
    }
    if (i.customId === 'help:act:online' || i.customId === 'help:act:top' || i.customId === 'help:act:topm') {
      const lang = langOf(i.locale);
      const ctx = await ctxFor(i, 'none');
      const keep = helpComponents(i.customId === 'help:act:topm' ? 'stat' : 'home', ctx) as never;
      if (i.customId === 'help:act:online') {
        const { data } = await backendJson<OnlineData>('/internal/discord/online');
        await i.editReply(data ? { embeds: [stamped(onlineEmbed(data))], components: keep } : { ...replyEmbed(tx('title', lang), tx('panelDown', lang), COLORS.bad), components: keep });
      } else {
        const { data } = await backendJson<TopData>(`/internal/discord/top?period=${i.customId === 'help:act:topm' ? 'month' : 'week'}`);
        await i.editReply(data ? { embeds: [stamped(topEmbed(data))], components: keep } : { ...replyEmbed(tx('title', lang), tx('panelDown', lang), COLORS.bad), components: keep });
      }
      return;
    }
    if (i.customId.startsWith('help:')) {
      // an id from an older version of the menu: the first screen instead of silence
      await i.editReply(helpView(null, await ctxFor(i, null)) as never);
      return;
    }
    if (i.customId === 'srv:list') {
      const s = await serversScreen();
      await i.editReply(s ? { ...s, attachments: [] } : { ...replyEmbed('Не получилось', 'Панель сейчас не отвечает. Попробуйте чуть позже.', COLORS.bad), components: [backButton()] });
      return;
    }
    const id = Number(i.customId.slice(4));
    if (!Number.isInteger(id) || id <= 0) return;
    await i.editReply((await serverCardReply(id)) as never);
  } catch (e) {
    log(`button ${i.customId} failed:`, (e as Error).message);
    await staleNotice(i);
  }
}

// used by the tests and by the check that every command is described
export const HELP_CATEGORIES: Category[] = CATEGORIES;
export const HELP_CMD_NAMES: string[] = CMDS.map((c) => c.cmd);
export type { Category };
