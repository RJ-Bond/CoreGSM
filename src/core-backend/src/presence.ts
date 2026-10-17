/**
 * What the bot shows under its name in the member list of a Discord server («Смотрит 26 игроков · 3/3 онлайн»):
 * the colour of the dot (green = all up, yellow = some server is down, red = all down) and a few lines it rotates
 * through: the totals, then every server, then a hint at the commands. Pure, so it is easy to test.
 */
export interface PresenceServer {
  name: string;
  online: boolean;
  players: number;
  maxPlayers: number;
  /** a server that never answered yet: not counted as a problem */
  hasStatus: boolean;
}

export type PresenceStatus = 'online' | 'idle' | 'dnd';

const MAX_SERVERS = 6;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plural = (n: number, one: string, few: string, many: string) => {
  const m = n % 100;
  const d = n % 10;
  return m >= 11 && m <= 14 ? many : d === 1 ? one : d >= 2 && d <= 4 ? few : many;
};

export function buildPresence(servers: PresenceServer[]): { status: PresenceStatus; lines: string[] } {
  const known = servers.filter((s) => s.hasStatus);
  const up = known.filter((s) => s.online);
  const players = up.reduce((n, s) => n + s.players, 0);
  const lines: string[] = [];
  if (servers.length === 0) return { status: 'online', lines: ['/register · /profile · /status'] };

  if (known.length === 0) lines.push('ждёт первого опроса серверов');
  else lines.push(`${players} ${plural(players, 'игрок', 'игрока', 'игроков')} · ${up.length}/${servers.length} онлайн`);
  // the busiest first; the offline ones last
  const ranked = [...known].sort((a, b) => Number(b.online) - Number(a.online) || b.players - a.players);
  for (const s of ranked.slice(0, MAX_SERVERS)) {
    lines.push(cut(s.online ? `${s.name}: ${s.players}/${s.maxPlayers || '?'}` : `${s.name}: офлайн`, 100));
  }
  lines.push('/status · /online · /top');

  const status: PresenceStatus = known.length > 0 && up.length === 0 ? 'dnd' : known.some((s) => !s.online) ? 'idle' : 'online';
  return { status, lines };
}
