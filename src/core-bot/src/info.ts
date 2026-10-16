/** Public slash commands: /online, /status, /player and /top. The answers are seen by everybody in the channel. */
import { AttachmentBuilder, EmbedBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { backend, backendJson } from './backend.js';
import { log } from './log.js';
import { COLORS, hoursText, replyEmbed } from './replies.js';

export const INFO_COMMANDS = [
  { name: 'online', description: 'Кто сейчас играет: онлайн всех серверов' },
  {
    name: 'status',
    description: 'Карточка сервера с графиком за сутки',
    options: [{ type: 3, name: 'server', description: 'Сервер', required: true, autocomplete: true }],
  },
  {
    name: 'player',
    description: 'Карточка игрока: часы, серия дней, где и когда играет',
    options: [{ type: 3, name: 'nick', description: 'Ник в игре', required: true, min_length: 1, max_length: 64, autocomplete: true }],
  },
  {
    name: 'top',
    description: 'Самые активные игроки',
    options: [{ type: 3, name: 'period', description: 'За какой срок', required: false, choices: [{ name: 'неделя', value: 'week' }, { name: 'месяц', value: 'month' }] }],
  },
];
export const INFO_NAMES = new Set(INFO_COMMANDS.map((c) => c.name));

export interface OnlineData {
  players: number;
  servers: { id: number; name: string; game: string; online: boolean; players: number; maxPlayers: number; map: string | null }[];
  url: string | null;
}
export interface PlayerData {
  name: string;
  online: boolean;
  lastSeen: number | null;
  hours: number;
  visits: number;
  days: number;
  streak: number;
  usualHour: number | null;
  servers: { name: string; hours: number }[];
  url: string | null;
}
export interface TopData { period: 'week' | 'month'; top: { name: string; hours: number; servers: number }[]; url: string | null }

const plural = (n: number, f: [string, string, string]) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  return a > 10 && a < 20 ? f[2] : b > 1 && b < 5 ? f[1] : b === 1 ? f[0] : f[2];
};
const bar = (p: number) => {
  const n = Math.max(0, Math.min(8, Math.round(p * 8)));
  return '█'.repeat(n) + '░'.repeat(8 - n);
};

export function onlineEmbed(d: OnlineData): EmbedBuilder {
  const up = d.servers.filter((s) => s.online);
  const lines = d.servers.slice(0, 20).map((s) =>
    s.online
      ? `🟢 **${s.name}** — ${s.players}${s.maxPlayers ? `/${s.maxPlayers}` : ''} ${s.maxPlayers ? bar(s.players / s.maxPlayers) : ''}${s.map ? ` · ${s.map}` : ''}`
      : `🔴 **${s.name}** — не в сети`,
  );
  const e = new EmbedBuilder()
    .setTitle(`🎮 Сейчас играют: ${d.players} ${plural(d.players, ['игрок', 'игрока', 'игроков'])}`)
    .setDescription((lines.join('\n') || 'Серверов пока нет.').slice(0, 3900))
    .setColor(up.length ? COLORS.ok : COLORS.bad)
    .setFooter({ text: `Серверов в сети: ${up.length} из ${d.servers.length} · CoreGSM` });
  if (d.url && /^https?:\/\//.test(d.url)) e.setURL(d.url);
  return e;
}

const partOfDay = (h: number) => (h < 6 ? 'ночью' : h < 12 ? 'утром' : h < 18 ? 'днём' : 'вечером');

export function playerEmbed(p: PlayerData): EmbedBuilder {
  const status = p.online ? '🟢 Сейчас в игре' : p.lastSeen ? `Был в игре <t:${Math.floor(p.lastSeen / 1000)}:R>` : '';
  const e = new EmbedBuilder()
    .setTitle(`👤 ${p.name}`.slice(0, 250))
    .setDescription([status, p.usualHour != null ? `Обычно играет ${partOfDay(p.usualHour)}, около ${String(p.usualHour).padStart(2, '0')}:00` : ''].filter(Boolean).join('\n') || ' ')
    .setColor(p.online ? COLORS.ok : COLORS.info)
    .addFields(
      { name: 'Часов', value: hoursText(p.hours), inline: true },
      { name: 'Визитов', value: String(p.visits), inline: true },
      { name: 'Подряд', value: `${p.streak >= 3 ? '🔥 ' : ''}${p.streak} ${plural(p.streak, ['день', 'дня', 'дней'])}`, inline: true },
    )
    .setFooter({ text: 'За последние 90 дней · CoreGSM' });
  if (p.servers.length) e.addFields({ name: 'Где играет', value: p.servers.slice(0, 5).map((s) => `${s.name} — ${hoursText(s.hours)} ч`).join('\n').slice(0, 1000) });
  if (p.url && /^https?:\/\//.test(p.url)) e.setURL(p.url);
  return e;
}

export function topEmbed(d: TopData): EmbedBuilder {
  const medals = ['🥇', '🥈', '🥉'];
  const lines = d.top.map((p, i) => `${medals[i] ?? `\`${String(i + 1).padStart(2, ' ')}\``} **${p.name}** — ${hoursText(p.hours)} ч`);
  const e = new EmbedBuilder()
    .setTitle(d.period === 'month' ? '🏆 Самые активные за месяц' : '🏆 Самые активные за неделю')
    .setDescription((lines.join('\n') || 'Пока никто не играл.').slice(0, 3900))
    .setColor(COLORS.warn)
    .setFooter({ text: 'CoreGSM' });
  if (d.url && /^https?:\/\//.test(d.url)) e.setURL(d.url);
  return e;
}

/** autocomplete of /status server and /player nick; answers within 3 s and never throws */
export async function infoAutocomplete(i: AutocompleteInteraction): Promise<void> {
  let items: { name: string; value: string }[] = [];
  try {
    const what = i.commandName === 'status' ? 'server' : 'nick';
    const q = new URLSearchParams({ what, q: String(i.options.getFocused()).slice(0, 60) });
    const r = await backend(`/internal/discord/suggest?${q.toString()}`, { signal: AbortSignal.timeout(2000) });
    const d = (await r.json()) as { items?: { name: string; value: string }[] };
    if (Array.isArray(d.items)) items = d.items.filter((x) => typeof x?.name === 'string' && typeof x?.value === 'string' && x.name.length > 0).slice(0, 25);
  } catch {
    items = [];
  }
  try {
    await i.respond(items);
  } catch (e) {
    log('autocomplete failed:', (e as Error).message);
  }
}

export async function handleInfo(i: ChatInputCommandInteraction): Promise<void> {
  try {
    await i.deferReply();
  } catch (e) {
    log(`/${i.commandName}: could not acknowledge:`, (e as Error).message);
    return;
  }
  const reply = async (p: Parameters<typeof i.editReply>[0]) => {
    try {
      await i.editReply(p);
    } catch (e) {
      log('reply failed:', (e as Error).message);
    }
  };
  const down = () => reply(replyEmbed('Не получилось', 'Панель сейчас не отвечает. Попробуйте чуть позже.', COLORS.bad));
  try {
    if (i.commandName === 'online') {
      const { data } = await backendJson<OnlineData>('/internal/discord/online');
      return void (await (data ? reply({ embeds: [onlineEmbed(data)] }) : down()));
    }
    if (i.commandName === 'top') {
      const period = i.options.getString('period') === 'month' ? 'month' : 'week';
      const { data } = await backendJson<TopData>(`/internal/discord/top?period=${period}`);
      return void (await (data ? reply({ embeds: [topEmbed(data)] }) : down()));
    }
    if (i.commandName === 'player') {
      const nick = i.options.getString('nick', true);
      const { status, data } = await backendJson<PlayerData>(`/internal/discord/player?nick=${encodeURIComponent(nick)}`);
      if (status === 404) return void (await reply(replyEmbed('Игрок не найден', `Ник «${nick.slice(0, 64)}» не появлялся на серверах за последние 90 дней.`, COLORS.warn)));
      return void (await (data ? reply({ embeds: [playerEmbed(data)] }) : down()));
    }
    // /status: the same picture card as in the status messages
    const id = Number(i.options.getString('server', true));
    if (!Number.isInteger(id) || id <= 0) return void (await reply(replyEmbed('Выберите сервер', 'Начните вводить название и выберите сервер из списка.', COLORS.warn)));
    const r = await backend(`/internal/card/${id}.png`);
    if (r.status === 404) return void (await reply(replyEmbed('Сервер не найден', 'Выберите сервер из списка подсказок.', COLORS.warn)));
    if (!r.ok) return void (await down());
    const file = new AttachmentBuilder(Buffer.from(await r.arrayBuffer()), { name: `server-${id}.png` });
    await reply({ files: [file] });
  } catch (e) {
    log(`/${i.commandName} failed:`, (e as Error).message);
    await down();
  }
}
