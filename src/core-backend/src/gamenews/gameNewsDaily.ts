/**
 * The daily summary of the joins and departures (plugin 0.18+), to the service channel of Discord once a day (the hour of the panel's
 * time zone is set, 9:00 by default), for the day before: how many came, how they left (a normal quit, a timeout, the check of Steam,
 * removed by CoreGSM), the timeouts by hour and by player, timeouts of several players at once, and what the plugin noticed (the network
 * of the server, a paused process, freezes, mass departures). Against the seven days before, so one day can be compared with another
 * (e.g. a day without BepInEx). A server with nothing that day is not told.
 * Settings: `gn_daily_summary` ('0' = off, on by default) and `gn_daily_hour` (0..23); in GET / PUT /api/game-news/plugin-alerts.
 */
import { db, getSetting, setSetting } from '../db.js';
import { systemTarget } from '../alerts/alertRoute.js';
import { alertSettings, enqueueAlert } from '../alerts/alerts.js';
import { localParts, zonedTime } from '../admin/localTime.js';
import { serverLabel } from './gameNewsVars.js';

const DAY = 86_400_000;
/** timeouts this close to each other are one outage (several players at once) */
const BURST_GAP_MS = 15_000;
const BURST_LEAST = 3;

export const DEFAULT_DAILY_HOUR = 9;
export const dailyOn = (): boolean => getSetting('gn_daily_summary') !== '0';
export const dailyHour = (): number => {
  const n = Number(getSetting('gn_daily_hour'));
  return getSetting('gn_daily_hour') != null && Number.isInteger(n) && n >= 0 && n <= 23 ? n : DEFAULT_DAILY_HOUR;
};
const tz = () => getSetting('timezone') || process.env.TZ || 'Europe/Moscow';

export interface ConnRow { ts: number; kind: string; platform_id: string; nick: string; reason: string; removed_by: string }
export interface NoteRow { kind: string; text: string }

export interface DayStats {
  joins: number; players: number; leaves: number;
  quit: number; timeouts: number; timeoutPlayers: number; steam: number; removed: number; other: number;
  /** outages that took several players at once: how many players each */
  bursts: number[];
  /** local hour → timeouts */
  hours: number[];
  /** players with two or more timeouts, most first */
  repeat: { nick: string; n: number }[];
  notes: { net: number; stood: number; freeze: number; mass: number };
}

export type LeaveSort = 'quit' | 'timeout' | 'steam' | 'removed' | 'other';
export function leaveSort(r: Pick<ConnRow, 'reason' | 'removed_by'>): LeaveSort {
  if (r.removed_by) return 'removed';
  if (/^timeout/i.test(r.reason)) return 'timeout';
  if (/^auth/i.test(r.reason)) return 'steam';
  if (/^leftgame/i.test(r.reason)) return 'quit';
  return 'other';
}

/** the numbers of one day of one server; pure, so it can be tested */
export function summarize(rows: ConnRow[], notes: NoteRow[], zone: string): DayStats {
  const s: DayStats = { joins: 0, players: 0, leaves: 0, quit: 0, timeouts: 0, timeoutPlayers: 0, steam: 0, removed: 0, other: 0, bursts: [], hours: Array(24).fill(0), repeat: [], notes: { net: 0, stood: 0, freeze: 0, mass: 0 } };
  const players = new Set<string>();
  const perPlayer = new Map<string, { nick: string; n: number }>();
  const timeouts: number[] = [];
  for (const r of rows) {
    if (r.platform_id) players.add(r.platform_id);
    if (r.kind === 'join') { s.joins++; continue; }
    if (r.kind !== 'leave') continue;
    s.leaves++;
    const sort = leaveSort(r);
    if (sort === 'timeout') {
      s.timeouts++;
      timeouts.push(r.ts);
      s.hours[localParts(r.ts, zone).hour]++;
      const key = r.platform_id || r.nick;
      const p = perPlayer.get(key) ?? { nick: r.nick || r.platform_id, n: 0 };
      p.n++;
      perPlayer.set(key, p);
    } else s[sort]++;
  }
  s.players = players.size;
  s.timeoutPlayers = perPlayer.size;
  s.repeat = [...perPlayer.values()].filter((p) => p.n >= 2).sort((a, b) => b.n - a.n).slice(0, 5);
  timeouts.sort((a, b) => a - b);
  let run = 0;
  for (let i = 0; i < timeouts.length; i++) {
    run = i > 0 && timeouts[i] - timeouts[i - 1] <= BURST_GAP_MS ? run + 1 : 1;
    const ends = i === timeouts.length - 1 || timeouts[i + 1] - timeouts[i] > BURST_GAP_MS;
    if (ends && run >= BURST_LEAST) s.bursts.push(run);
  }
  for (const n of notes) {
    if (/^СЕТЬ СЕРВЕРА/.test(n.text)) s.notes.net++;
    else if (/^ПРОЦЕСС СТОЯЛ/.test(n.text)) s.notes.stood++;
    else if (n.kind === 'freeze') s.notes.freeze++;
    else if (n.kind === 'mass') s.notes.mass++;
  }
  return s;
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '–');
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

/** the busiest hours of the timeouts, e.g. «14 ч ×3, 8 ч ×1» */
export function busyHours(hours: number[]): string {
  return hours.map((n, h) => ({ h, n })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.h - b.h).slice(0, 4).map((x) => `${x.h} ч ×${x.n}`).join(', ');
}

/** the text of the summary of one server; `week` = the timeouts and departures of the seven days before (for the comparison) */
export function dailyText(s: DayStats, week: { timeouts: number; leaves: number; days: number }): string {
  const lines: string[] = [];
  lines.push(`Заходов **${s.joins}**, игроков **${s.players}**, выходов **${s.leaves}**`);
  const parts = [`обычный выход ${s.quit}`, `**таймаут ${s.timeouts}** (${pct(s.timeouts, s.leaves)}, ${s.timeoutPlayers} ${plural(s.timeoutPlayers, 'игрок', 'игрока', 'игроков')})`];
  if (s.steam) parts.push(`проверка Steam ${s.steam}`);
  if (s.removed) parts.push(`снял CoreGSM ${s.removed}`);
  if (s.other) parts.push(`другое ${s.other}`);
  lines.push(`Как выходили: ${parts.join(' · ')}`);
  if (s.timeouts) {
    lines.push(`Таймауты по часам: ${busyHours(s.hours)}`);
    lines.push(s.bursts.length
      ? `Обрывы сразу у нескольких игроков: **${s.bursts.length}** (${s.bursts.map((n) => `${n} ${plural(n, 'игрок', 'игрока', 'игроков')}`).join(', ')}) — похоже на сеть или паузу самого сервера`
      : 'Обрывов сразу у нескольких игроков не было — таймауты одиночные');
    if (s.repeat.length) lines.push(`Чаще других: ${s.repeat.map((p) => `${p.nick} ×${p.n}`).join(', ')}`);
  }
  if (week.days > 0) {
    const avg = week.timeouts / week.days;
    lines.push(`За ${week.days} ${plural(week.days, 'день', 'дня', 'дней')} до этого: в среднем ${avg.toFixed(1).replace('.', ',')} таймаута в день (${pct(week.timeouts, week.leaves)} выходов)`);
  }
  const n = s.notes;
  const plugin = [
    n.net ? `обрывов сети сервера ${n.net}` : '',
    n.stood ? `пауз процесса/ВМ ${n.stood}` : '',
    n.freeze ? `замираний ${n.freeze}` : '',
    n.mass ? `массовых выходов ${n.mass}` : '',
  ].filter(Boolean);
  lines.push(plugin.length ? `Плагин заметил: ${plugin.join(', ')}` : 'Плагин не заметил сбоев сети, пауз и замираний');
  return lines.join('\n');
}

function rowsOf(serverId: number, from: number, to: number): ConnRow[] {
  return db.prepare('SELECT ts, kind, platform_id, nick, reason, removed_by FROM game_connections WHERE server_id = ? AND ts >= ? AND ts < ? ORDER BY ts').all(serverId, from, to) as ConnRow[];
}
function notesOf(serverId: number, from: number, to: number): NoteRow[] {
  try {
    return db.prepare('SELECT kind, text FROM game_plugin_log WHERE server_id = ? AND ts >= ? AND ts < ?').all(serverId, from, to) as NoteRow[];
  } catch {
    return [];
  }
}

/** the summary of the local day `day` ("YYYY-MM-DD") for every server that had something; [server, text] */
export function buildDaily(day: string, zone = tz()): { serverId: number; name: string; text: string }[] {
  const from = zonedTime(day, 0, zone);
  const to = zonedTime(localParts(from + DAY + 3 * 3_600_000, zone).day, 0, zone); // the next midnight (a day may be 23 or 25 h)
  const servers = db.prepare('SELECT DISTINCT server_id FROM game_connections WHERE ts >= ? AND ts < ?').all(from, to) as { server_id: number }[];
  const out: { serverId: number; name: string; text: string }[] = [];
  for (const { server_id: id } of servers) {
    const s = summarize(rowsOf(id, from, to), notesOf(id, from, to), zone);
    if (s.joins + s.leaves === 0) continue;
    // the seven days before, as far as the journal goes back (it keeps 30 days)
    const before = rowsOf(id, from - 7 * DAY, from);
    const first = before.length ? before[0].ts : from;
    const days = Math.min(7, Math.floor((from - first) / DAY));
    const prev = before.filter((r) => r.ts >= from - days * DAY && r.kind === 'leave');
    out.push({ serverId: id, name: serverLabel(id), text: dailyText(s, { timeouts: prev.filter((r) => leaveSort(r) === 'timeout').length, leaves: prev.length, days }) });
  }
  return out;
}

const DAY_NAMES = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const dayTitle = (day: string): string => {
  const [, m, d] = day.split('-').map(Number);
  return `${d} ${DAY_NAMES[m - 1] ?? ''}`;
};

/** called by the timer: after the hour, once a day, the day before goes to the service channel; the number of messages */
export function checkDaily(now = Date.now()): number {
  if (!dailyOn()) return 0;
  const zone = tz();
  const today = localParts(now, zone);
  if (today.hour < dailyHour()) return 0;
  if (getSetting('gn_daily_last') === today.day) return 0;
  setSetting('gn_daily_last', today.day);
  const yesterday = localParts(zonedTime(today.day, 0, zone) - 3_600_000, zone).day;
  const target = systemTarget(alertSettings());
  if (!target) return 0;
  let n = 0;
  for (const s of buildDaily(yesterday, zone)) {
    try {
      enqueueAlert('update', s.name, {
        content: '', mention: 'none',
        embed: { title: `📊 Входы и выходы за ${dayTitle(yesterday)}`, description: `Сервер **${s.name}**\n${s.text}`, color: 0x5865f2, timestamp: new Date(now).toISOString() },
      });
      n++;
    } catch { /* one server must not stop the others */ }
  }
  return n;
}
