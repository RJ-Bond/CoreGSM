/**
 * The Discord embed for a server: one definition used by the bot (what is posted in the channel)
 * and by the panel (the preview). The result is a plain Discord API embed object.
 *
 * Layout (three columns): status · address · country / game · map · players / player list.
 */
import { gameLabel } from './games.js';

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
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  author?: { name: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string; icon_url?: string };
  thumbnail?: { url: string };
  timestamp?: string;
}

export interface EmbedExtra {
  /** last time the server answered (for the offline note) */
  lastOnlineAt?: number | null;
  /** public URL of the game icon (needs a public domain; omitted otherwise) */
  thumbUrl?: string | null;
  /** public base URL (https://domain): used for the footer logo */
  baseUrl?: string | null;
  /** panel build id, shown in the footer */
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

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** games whose clients have a console with the "connect" command */
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
  const version = extra.version ? ` v${extra.version.slice(0, 7)}` : '';
  const when = stamp(s.updatedAt ?? Date.now(), extra.timeZone || 'Europe/Moscow');
  const footer: { text: string; icon_url?: string } = { text: `${brand}${version} | Мониторинг игровых серверов | Обновлено: ${when}` };
  if (extra.baseUrl) footer.icon_url = extra.logoUrl || `${extra.baseUrl}/logo-128.png`;
  const thumbnail = extra.thumbUrl ? { url: extra.thumbUrl } : undefined;
  const addr = `\`${s.address}\``;

  if (!s.hasStatus) {
    return {
      title: cut(s.name, 256),
      description: `📍 ${addr}\n⏳ Жду первого ответа сервера…`,
      color: COLOR.unknown,
      thumbnail,
      footer,
    };
  }

  const lag = s.online && s.ping != null && s.ping > 100;
  const status = !s.online ? '🔴 **Офлайн**' : lag ? '🟡 **Лаги**' : '🟢 **Онлайн**';
  const ping = s.online && s.ping != null ? ` · ${s.ping} мс` : '';
  const pct = s.maxPlayers ? ` (${Math.round((Math.min(s.players, s.maxPlayers) / s.maxPlayers) * 100)}%)` : '';

  const fields: NonNullable<DiscordEmbed['fields']> = [
    { name: '📶 Статус', value: `${status}${ping}`, inline: true },
    { name: '📍 Адрес:порт', value: addr, inline: true },
    { name: extra.country ? '🌍 Страна' : '🔖 Версия', value: extra.country || s.version || '—', inline: true },
    { name: '🎮 Игра', value: cut(gameLabel(s.game), 100), inline: true },
    { name: '🗺️ Текущая карта', value: s.online && s.map ? cut(s.map, 100) : '—', inline: true },
    { name: '👥 Игроки', value: s.online ? `**${s.players}**/${s.maxPlayers || '?'}${pct}` : '—', inline: true },
  ];

  if (s.online) {
    if (s.playerNames.length > 0) {
      const shown = s.playerNames.slice(0, 18);
      const rest = s.players - shown.length;
      let list = nameRows(shown);
      if (rest > 0) list += `\n… и ещё ${rest}`;
      fields.push({ name: `🧑‍🤝‍🧑 Сейчас в игре (${s.players})`, value: cut(list, 1000) });
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
    description: lines.length ? lines.join('\n') : undefined,
    color: !s.online ? COLOR.offline : lag ? COLOR.lag : COLOR.online,
    thumbnail,
    fields,
    footer,
  };
}
