/**
 * The Discord embed for a server: one definition used by the bot (what is posted in the channel)
 * and by the panel (the preview). The result is a plain Discord API embed object.
 *
 * Layout (three columns): status · address · country / game · map · players / player list.
 */
import { playersBar } from './chartLogic.js';
import { gameLabel, gameProfile, gameShowsMap } from './games.js';

export interface EmbedServer {
  name: string;
  game: string;
  address: string;
  hasStatus: boolean;
  online: boolean;
  players: number;
  maxPlayers: number;
  map: string | null;
  version: string | null;
  ping: number | null;
  playerNames: string[];
  error: string | null;
  updatedAt: number | null;
  /** planned work in progress (maintenance window) */
  maintenance?: { name: string; until: number } | null;
}

export interface DiscordEmbed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  author?: { name: string; url?: string; icon_url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string; icon_url?: string };
  thumbnail?: { url: string };
  image?: { url: string };
  timestamp?: string;
}

export interface EmbedExtra {
  /** how many player names the message lists (0 = only the counter); default 5 */
  playersShown?: number | null;
  /** panel server id: the title and the "all players" link point to its page */
  serverId?: number | null;
  /** last time the server answered (for the offline note) */
  lastOnlineAt?: number | null;
  /** public URL of the game icon (needs a public domain; omitted otherwise) */
  thumbUrl?: string | null;
  /** the 24-hour online chart shown under the embed (a public signed PNG) */
  chartUrl?: string | null;
  /** public base URL (https://domain): used for the footer logo */
  baseUrl?: string | null;
  /** panel version («1.0.0.7») or, on an install that has no name yet, the build id; shown in the footer */
  version?: string | null;
  /** community name and custom logo from the branding settings */
  brandName?: string | null;
  logoUrl?: string | null;
  /** "🇵🇱 Польша" */
  country?: string | null;
  /** IANA time zone for the "updated" time in the footer */
  timeZone?: string | null;
}

const COLOR = { online: 0x23a55a, lag: 0xf0b232, offline: 0xf23f42, unknown: 0x5a4bd1 };

/** the side stripe of an online server follows the colour of its game (others keep the status green) */
const accentOf = (game: string): number | undefined => gameProfile(game)?.accent;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** games whose clients have a console with the "connect" command */
/** Discord sizes an embed to its content, so embeds in one message get different widths; a line of invisible
 *  characters (U+2800) pushes every embed to the same maximum width. Tune with EMBED_WIDTH_PAD. */
const WIDTH_PAD = '⠀'.repeat(Number(process.env.EMBED_WIDTH_PAD) || 40);

const SOURCE_GAMES = new Set(['counterstrike2', 'csgo', 'counterstrike16', 'css', 'teamfortress2', 'garrysmod', 'l4d2']);

/** player names in rows of three: "Hustler · 69 · qlte" */
function nameRows(names: string[], per = 3): string {
  const rows: string[] = [];
  for (let i = 0; i < names.length; i += per) {
    rows.push(
      names
        .slice(i, i + per)
        .map((n) => cut(n.replace(/[*_~`|>]/g, ''), 20))
        .join(' · '),
    );
  }
  return rows.join('\n');
}

/** 12.03.2026 10:04:02 */
function stamp(ms: number, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  try {
    return new Date(ms).toLocaleString('ru-RU', { ...opts, timeZone }).replace(',', '');
  } catch {
    return new Date(ms).toLocaleString('ru-RU', opts).replace(',', '');
  }
}

export function buildEmbed(s: EmbedServer, uptimePct: number | null, intervalSec: number, extra: EmbedExtra = {}): DiscordEmbed {
  void uptimePct;
  void intervalSec;
  const brand = extra.brandName || 'CoreGSM';
  // a readable version («1.0.0.7») is shown whole, a bare build hash is shortened
  const version = extra.version ? ` · v${/^\d+(\.\d+){1,4}$/.test(extra.version) ? extra.version : extra.version.slice(0, 7)}` : '';
  // the footer is only the brand and the build; the update time is the embed timestamp, which Discord shows in the
  // viewer's own time zone ("Сегодня, в 09:49"). The brand line with the link to the panel sits above the title.
  const footer: { text: string; icon_url?: string } = { text: `${brand}${version}` };
  const logo = extra.baseUrl ? extra.logoUrl || `${extra.baseUrl}/logo-128.png` : undefined;
  if (logo) footer.icon_url = logo;
  const author: NonNullable<DiscordEmbed['author']> = { name: `${brand} · Мониторинг игровых серверов` };
  if (extra.baseUrl) author.url = extra.baseUrl;
  if (logo) author.icon_url = logo;
  const timestamp = new Date(s.updatedAt ?? Date.now()).toISOString();
  const thumbnail = extra.thumbUrl ? { url: extra.thumbUrl } : undefined;
  const addr = `\`${s.address}\``;

  if (!s.hasStatus) {
    return {
      title: cut(s.name, 256),
      description: `📍 ${addr}\n⏳ Жду первого ответа сервера…`,
      color: accentOf(s.game) ?? COLOR.unknown,
      thumbnail,
      author,
      timestamp,
      footer,
    };
  }

  const lag = s.online && s.ping != null && s.ping > 100;
  const status = !s.online && s.maintenance ? '🛠️ **Тех. работы**' : !s.online ? '🔴 **Офлайн**' : lag ? '🟡 **Лаги**' : '🟢 **Онлайн**';
  const ping = s.online && s.ping != null ? ` · ${s.ping} мс` : '';
  const pct = s.maxPlayers ? ` (${Math.round((Math.min(s.players, s.maxPlayers) / s.maxPlayers) * 100)}%)` : '';

  // third row, last column: the country; without one, the game version when it says something
  const ver = (s.version ?? '').trim();
  const realVersion = ver && !/^0(\.0)*(\.\d+)?$/.test(ver) ? ver : null;
  const third: { name: string; value: string; inline: boolean } | null = extra.country
    ? { name: '🌍 Страна', value: extra.country, inline: true }
    : realVersion
      ? { name: '🔖 Версия', value: cut(realVersion, 100), inline: true }
      : null;

  // players with a fill bar of 6 squares: the colour of the game, the last two squares turn amber and red as it fills up
  const bar = s.online && s.maxPlayers ? '\n' + playersBar(s.players, s.maxPlayers, s.game === 'vrising' ? '🟪' : s.game === 'icarus' ? '🟨' : '🟩') : '';
  const uptime = uptimePct == null ? '—' : `${Math.round(uptimePct * 10) / 10}%`;

  const fields: NonNullable<DiscordEmbed['fields']> = [
    { name: '📶 Статус', value: `${status}${ping}`, inline: true },
    { name: '👥 Игроки', value: s.online ? `**${s.players}**/${s.maxPlayers || '?'}${pct}${bar}` : '—', inline: true },
    { name: '⏱️ Аптайм 24 ч', value: uptime, inline: true },
    { name: '📍 Адрес', value: `${addr} ${WIDTH_PAD}`, inline: false },
    { name: '🎮 Игра', value: cut(gameLabel(s.game), 100), inline: true },
    // games whose profile says "no map" (Minecraft, V Rising, ...) do not get the field at all
    ...(gameShowsMap(s.game) ? [{ name: '🗺️ Карта', value: s.online && s.map ? cut(s.map, 100) : '—', inline: true }] : []),
    ...(third ? [third] : []),
  ];

  if (s.online) {
    if (s.playerNames.length > 0) {
      const limit = Math.min(20, Math.max(0, Math.round(extra.playersShown ?? 5)));
      const shown = s.playerNames.slice(0, limit);
      const rest = s.players - shown.length;
      let list = nameRows(shown);
      if (limit === 0) list = '';
      if (rest > 0) {
        const tail = extra.baseUrl && extra.serverId ? `… и ещё ${rest}: [все игроки в панели](${extra.baseUrl}/go/servers/${extra.serverId}/players)` : `… и ещё ${rest}`;
        list = list ? `${list}
${tail}` : tail;
      }
      fields.push({ name: `🧑‍🤝‍🧑 Сейчас в игре (${s.players})`, value: cut(list || '\u200b', 1000) });
    } else if (s.players === 0) {
      fields.push({ name: '🧑‍🤝‍🧑 Сейчас в игре', value: 'Пока никого нет' });
    }
  } else {
    fields.push({
      name: '⏱️ Последний раз онлайн',
      value: extra.lastOnlineAt ? `<t:${Math.floor(extra.lastOnlineAt / 1000)}:R>` : 'за последние сутки не отвечал',
      inline: true,
    });
  }

  const lines: string[] = [];
  if (!s.online) lines.push(`⚠️ ${s.error ? cut(s.error, 300) : 'Сервер не отвечает'}`);
  if (SOURCE_GAMES.has(s.game)) lines.push(`🖥️ Консоль: \`connect ${s.address}\``);

  return {
    title: cut(s.name, 256),
    url: extra.baseUrl && extra.serverId ? `${extra.baseUrl}/go/servers/${extra.serverId}` : undefined,
    description: lines.length ? lines.join('\n') : undefined,
    color: !s.online ? COLOR.offline : lag ? COLOR.lag : (accentOf(s.game) ?? COLOR.online),
    thumbnail,
    ...(extra.chartUrl ? { image: { url: extra.chartUrl } } : {}),
    fields,
    author,
    timestamp,
    footer,
  };
}
