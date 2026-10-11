/**
 * The Discord embed for a server: one definition used by the bot (what is posted in the channel)
 * and by the panel (the preview). The result is a plain Discord API embed object.
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
}

const COLOR = { online: 0x23a55a, lag: 0xf0b232, offline: 0xf23f42, unknown: 0x5a4bd1 };

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** games whose clients have a console with the "connect" command */
const SOURCE_GAMES = new Set(['counterstrike2', 'csgo', 'counterstrike16', 'css', 'teamfortress2', 'garrysmod', 'l4d2']);

/** placeholder versions such as 0.0.0.1 say nothing */
const usefulVersion = (v: string | null): string | null => {
  const t = (v ?? '').trim();
  return t && !/^0(\.0)*(\.\d+)?$/.test(t) ? t : null;
};

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

function every(sec: number): string {
  if (sec === 60) return 'раз в минуту';
  if (sec === 3600) return 'раз в час';
  if (sec % 60 === 0) return `раз в ${sec / 60} мин`;
  return `раз в ${sec} с`;
}

export function buildEmbed(s: EmbedServer, uptimePct: number | null, intervalSec: number, extra: EmbedExtra = {}): DiscordEmbed {
  const parts = [extra.brandName || 'CoreGSM'];
  if (extra.version) parts[0] += ` · v${extra.version.slice(0, 7)}`;
  if (uptimePct != null) parts.push(`аптайм ${Math.round(uptimePct * 10) / 10}%`);
  parts.push(`обновление ${every(intervalSec)}`);
  const footer: { text: string; icon_url?: string } = { text: parts.join(' · ') };
  if (extra.baseUrl) footer.icon_url = extra.logoUrl || `${extra.baseUrl}/logo-128.png`;
  const stamp = (s.updatedAt ? new Date(s.updatedAt) : new Date()).toISOString();
  const thumbnail = extra.thumbUrl ? { url: extra.thumbUrl } : undefined;

  if (!s.hasStatus) {
    return {
      title: cut(`⏳ ${s.name}`, 256),
      description: `📍 \`${s.address}\`\nЖду первого ответа сервера…`,
      color: COLOR.unknown,
      author: { name: `🎮 ${gameLabel(s.game)}` },
      thumbnail,
      footer,
      timestamp: stamp,
    };
  }

  const lag = s.online && s.ping != null && s.ping > 100;
  const emoji = !s.online ? '🔴' : lag ? '🟡' : '🟢';

  const fields: NonNullable<DiscordEmbed['fields']> = [];
  if (s.online) {
    const pct = s.maxPlayers ? ` · ${Math.round((Math.min(s.players, s.maxPlayers) / s.maxPlayers) * 100)}%` : '';
    fields.push({ name: '👥 Игроки', value: `**${s.players}** / ${s.maxPlayers || '?'}${pct}`, inline: true });
    fields.push({ name: '📡 Пинг', value: s.ping != null ? `${s.ping} мс` : '—', inline: true });
    fields.push({ name: '🗺️ Карта', value: s.map ? cut(s.map, 100) : '—', inline: true });
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
    fields.push({ name: '🔄 Проверено', value: s.updatedAt ? `<t:${Math.floor(s.updatedAt / 1000)}:R>` : '—', inline: true });
  }

  const addr = `📍 \`${s.address}\``;
  const description = [SOURCE_GAMES.has(s.game) ? `${addr}  ·  консоль: \`connect ${s.address}\`` : addr];
  if (!s.online) description.push(`⚠️ ${s.error ? cut(s.error, 300) : 'Сервер не отвечает'}`);

  const version = usefulVersion(s.version);
  return {
    title: cut(`${emoji} ${s.name}`, 256),
    description: description.join('\n'),
    color: !s.online ? COLOR.offline : lag ? COLOR.lag : COLOR.online,
    author: { name: `🎮 ${gameLabel(s.game)}${version ? ` · ${version}` : ''}` },
    thumbnail,
    fields,
    footer,
    timestamp: stamp,
  };
}
