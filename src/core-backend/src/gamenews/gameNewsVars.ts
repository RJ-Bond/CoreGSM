/**
 * The variables of a game message: {server} {online} {max} {time} {greeting} {restart} {wipe} {discord} {tip}.
 * They are filled in for each server when a message is queued or when the plugin asks for the greeting.
 * A value that is not known right now is «—» (a text like «До рестарта: —» still reads well).
 */
import { db, getSetting, setSetting } from '../db.js';
import { localParts } from '../admin/localTime.js';
import { nextRun } from '../monitoring/restartLogic.js';
import { plainLine } from './gameNewsJoinLeave.js';
import { activeChatKinds, normalizeChat, type ChatKind } from './gameNewsChatLogic.js';
import { VARIABLES, type Vars } from './gameNewsLogic.js';

/** the plugin counts as «online» when it polled within this time */
export const ONLINE_MS = 30_000;

export const panelTz = (): string => getSetting('timezone') || process.env.TZ || 'Europe/Moscow';

// the name of a server: the one typed in the panel, the one from the query, the one the game plugin reported, host:port
export const NAME_SQL = "COALESCE(NULLIF(s.name, ''), NULLIF(st.name, ''), NULLIF(t.plugin_name, ''), s.host || ':' || s.port)";
export const serverLabel = (id: number): string =>
  (db.prepare(`SELECT ${NAME_SQL} AS n FROM servers s LEFT JOIN status st ON st.server_id = s.id LEFT JOIN game_news_targets t ON t.server_id = s.id WHERE s.id = ?`).get(id) as { n: string } | undefined)?.n ?? `#${id}`;

interface TargetLive { last_seen: number; plugin_players: number; plugin_max: number }

/**
 * Who is playing: what the game plugin reports while it is online (it sees the server from inside), else the last query
 * of the panel (a server in a home network is not reachable for a panel on the internet).
 */
export function liveState(id: number, now: number): { online: boolean; players: number; max: number } | undefined {
  const t = db.prepare('SELECT last_seen, plugin_players, plugin_max FROM game_news_targets WHERE server_id = ?').get(id) as TargetLive | undefined;
  if (t && t.last_seen > 0 && now - t.last_seen < ONLINE_MS * 2 && t.plugin_players >= 0) return { online: true, players: t.plugin_players, max: t.plugin_max };
  const s = db.prepare('SELECT online, players, max_players FROM status WHERE server_id = ?').get(id) as { online: number; players: number; max_players: number } | undefined;
  return s ? { online: !!s.online, players: s.players, max: s.max_players } : undefined;
}

function fmt(now: number, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', { timeZone: panelTz(), hourCycle: 'h23', ...opts }).format(new Date(now));
  } catch {
    return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', hourCycle: 'h23', ...opts }).format(new Date(now));
  }
}

/** the current time of day in the panel's time zone, «20:05» */
export const clock = (now: number): string => fmt(now, { hour: '2-digit', minute: '2-digit' });

/** «Доброе утро» ... by the hour in the panel's time zone */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Добрый день';
  if (hour >= 18 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

/** «3 ч 20 мин», «45 мин», «менее минуты» */
export function leftText(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return 'менее минуты';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h >= 24) { const d = Math.floor(h / 24); return `${d} д${h % 24 ? ` ${h % 24} ч` : ''}`; }
  return h ? `${h} ч${m ? ` ${m} мин` : ''}` : `${m} мин`;
}

function restartLeft(serverId: number, now: number): string {
  const p = db.prepare('SELECT days, at_min FROM restart_plans WHERE server_id = ? AND enabled = 1').get(serverId) as { days: number; at_min: number } | undefined;
  const at = p ? nextRun(p, now, panelTz()) : null;
  return at ? leftText(at - now) : '—';
}

function nextWipe(serverId: number, now: number): string {
  const w = db.prepare("SELECT wipe_at FROM wipe_scenarios WHERE server_id = ? AND status = 'scheduled' AND wipe_at > ? ORDER BY wipe_at LIMIT 1").get(serverId, now) as { wipe_at: number } | undefined;
  return w ? fmt(w.wipe_at, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
}

/** the kinds of game chat that are forwarded to Discord (switch on, a webhook set, the kind not turned off): what the plugin reads */
export function chatKindsConfigured(): ChatKind[] {
  try {
    return activeChatKinds(normalizeChat(JSON.parse(getSetting('gamenews_chat') || '{}')));
  } catch {
    return [];
  }
}

/** registration from the game is switched on (the setting is kept by gameNewsRegister.ts) */
export function registerEnabled(): boolean {
  try { return (JSON.parse(getSetting('gamenews_register') || '{}') as { enabled?: boolean }).enabled === true; } catch { return false; }
}

// ---- what the administrator keeps for {discord} and {tip}
export interface Extras { discord: string; tips: string[] }
export const MAX_TIPS = 20;

export function getExtras(): Extras {
  try {
    const v = JSON.parse(getSetting('gamenews_extras') || '{}') as Partial<Extras>;
    return { discord: typeof v.discord === 'string' ? v.discord : '', tips: Array.isArray(v.tips) ? v.tips.filter((x): x is string => typeof x === 'string').slice(0, MAX_TIPS) : [] };
  } catch {
    return { discord: '', tips: [] };
  }
}

export function setExtras(e: Extras): void {
  setSetting('gamenews_extras', JSON.stringify({ discord: plainLine(e.discord).slice(0, 100), tips: e.tips.map((t) => plainLine(t).slice(0, 200)).filter(Boolean).slice(0, MAX_TIPS) }));
}

/** every variable for one server at a moment (a random tip each time) */
export function varsFor(serverId: number, now: number): Vars {
  const live = liveState(serverId, now);
  const ex = getExtras();
  const tip = ex.tips.length ? ex.tips[Math.floor(Math.random() * ex.tips.length)] : '';
  const v: Vars = {
    server: serverLabel(serverId),
    online: String(live?.players ?? 0),
    max: String(live?.max ?? 0),
    time: clock(now),
    greeting: greetingFor(localParts(now, panelTz()).hour),
    restart: restartLeft(serverId, now),
    wipe: nextWipe(serverId, now),
    discord: ex.discord || '—',
    tip: tip || '—',
  };
  for (const k of VARIABLES) if (!v[k]) v[k] = '—';
  return v;
}
