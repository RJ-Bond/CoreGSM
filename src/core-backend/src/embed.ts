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
  footer?: { text: string };
  timestamp?: string;
}

const COLOR = { online: 0x23a55a, lag: 0xf0b232, offline: 0xf23f42, unknown: 0x5a4bd1 };

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** ▰▰▰▰▱▱▱▱▱▱ 40% */
function bar(value: number, max: number): string {
  const ratio = Math.max(0, Math.min(1, value / max));
  const filled = Math.round(ratio * 10);
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}`;
}

function every(sec: number): string {
  if (sec === 60) return 'каждую минуту';
  if (sec === 3600) return 'каждый час';
  if (sec % 60 === 0) return `каждые ${sec / 60} мин`;
  return `каждые ${sec} с`;
}

export function buildEmbed(s: EmbedServer, uptimePct: number | null, intervalSec: number): DiscordEmbed {
  const footer = { text: `CoreGSM · обновляется ${every(intervalSec)}` };
  const stamp = (s.updatedAt ? new Date(s.updatedAt) : new Date()).toISOString();

  if (!s.hasStatus) {
    return {
      title: cut(`⏳ ${s.name}`, 256),
      description: `📍 \`${s.address}\`\nЖду первого ответа сервера…`,
      color: COLOR.unknown,
      author: { name: `🎮 ${gameLabel(s.game)}` },
      footer,
      timestamp: stamp,
    };
  }

  const lag = s.online && s.ping != null && s.ping > 100;
  const emoji = !s.online ? '🔴' : lag ? '🟡' : '🟢';
  const status = !s.online ? '🔴 Офлайн' : lag ? '🟡 Лаги' : '🟢 Онлайн';
  const checked = s.updatedAt ? `<t:${Math.floor(s.updatedAt / 1000)}:R>` : '—';
  const uptime = uptimePct == null ? '—' : `${(Math.round(uptimePct * 10) / 10).toFixed(1)}%`;

  const fields: NonNullable<DiscordEmbed['fields']> = [];
  fields.push({ name: '📶 Статус', value: status, inline: true });
  fields.push({
    name: '👥 Игроки',
    // "31 / 50 · 62%" on the first line, the bar below it, so neither wraps in a narrow column
    value: s.online
      ? `**${s.players}** / ${s.maxPlayers || '?'}${
          s.maxPlayers ? ` · ${Math.round((Math.min(s.players, s.maxPlayers) / s.maxPlayers) * 100)}%\n${bar(s.players, s.maxPlayers)}` : ''
        }`
      : '—',
    inline: true,
  });
  fields.push({ name: '📡 Пинг', value: s.online && s.ping != null ? `${s.ping} мс` : '—', inline: true });
  fields.push({ name: '🗺️ Карта', value: s.online && s.map ? cut(s.map, 100) : '—', inline: true });
  fields.push({ name: '📈 Аптайм 24 ч', value: uptime, inline: true });
  fields.push({ name: '🕒 Проверено', value: checked, inline: true });

  if (s.online) {
    if (s.playerNames.length > 0) {
      const shown = s.playerNames.slice(0, 15).map((n) => `• ${cut(n, 32)}`);
      const rest = s.players - shown.length;
      let list = shown.join('\n');
      if (rest > 0) list += `\n… и ещё ${rest}`;
      fields.push({ name: `🧑‍🤝‍🧑 Сейчас в игре (${s.players})`, value: cut(list, 1000) });
    } else if (s.players === 0) {
      fields.push({ name: '🧑‍🤝‍🧑 Сейчас в игре', value: 'Пока никого нет' });
    }
  }

  const description = [`📍 \`${s.address}\``];
  if (!s.online && s.error) description.push(`⚠️ ${cut(s.error, 300)}`);

  return {
    title: cut(`${emoji} ${s.name}`, 256),
    description: description.join('\n'),
    color: !s.online ? COLOR.offline : lag ? COLOR.lag : COLOR.online,
    author: { name: `🎮 ${gameLabel(s.game)}${s.version ? ` · ${s.version}` : ''}` },
    fields,
    footer,
    timestamp: stamp,
  };
}
