/** The live dashboard message: one embed with every server, edited by the bot every minute. No discord.js import. */

export interface DashServer { id: number; name: string; online: boolean; players: number; maxPlayers: number; map: string | null }
export interface DashOnline { players: number; servers: DashServer[]; url: string | null }
export interface DashTop { top: { name: string; hours: number }[] }
export interface DashStyle { footer: string; accent: number; logoUrl: string | null; version: string }

export const DASH_INTERVAL_MS = 60_000;

const bar = (p: number): string => {
  const n = Math.max(0, Math.min(8, Math.round(p * 8)));
  return '█'.repeat(n) + '░'.repeat(8 - n);
};
const hours = (h: number): string => (Number.isInteger(h) ? String(h) : h.toFixed(1)).replace('.', ',');

export const dashColor = (up: number, total: number): number => (total === 0 || up === 0 ? 0xe74c3c : up < total ? 0xf5b01e : 0x2ecc71);

export function serverLine(s: DashServer): string {
  if (!s.online) return `🔴 **${s.name}** — не в сети`;
  const cap = s.maxPlayers > 0 ? `${s.players}/${s.maxPlayers} ${bar(s.players / s.maxPlayers)}` : String(s.players);
  return `🟢 **${s.name}** — ${cap}${s.map ? ` · ${s.map}` : ''}`;
}

export function dashboardEmbed(o: DashOnline, top: DashTop | null, st: DashStyle, now = Date.now()) {
  const up = o.servers.filter((s) => s.online).length;
  const shown = o.servers.slice(0, 15);
  const lines = shown.map(serverLine);
  if (o.servers.length > shown.length) lines.push(`…и ещё ${o.servers.length - shown.length}`);
  const medals = ['🥇', '🥈', '🥉'];
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: '🎮 Играют сейчас', value: `**${o.players}**`, inline: true },
    { name: '🖥️ Серверов в сети', value: `**${up}** из ${o.servers.length}`, inline: true },
  ];
  const t = (top?.top ?? []).slice(0, 3);
  if (t.length) fields.push({ name: '🏆 Топ недели', value: t.map((p, i) => `${medals[i]} **${p.name}** — ${hours(p.hours)} ч`).join('\n').slice(0, 1000) });
  return {
    title: `📡 Серверы · ${up}/${o.servers.length} онлайн · ${o.players} ${o.players === 1 ? 'игрок' : 'игроков'}`,
    description: (lines.join('\n') || 'Серверов пока нет.').slice(0, 3900),
    color: dashColor(up, o.servers.length),
    fields,
    footer: { text: ['Обновляется каждую минуту', st.footer, st.version ? `v${st.version}` : ''].filter(Boolean).join(' · '), ...(st.logoUrl ? { icon_url: st.logoUrl } : {}) },
    timestamp: new Date(now).toISOString(),
  };
}
