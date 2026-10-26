/** V Rising: rank ladder, hours and achievements. */
import { db } from './db.js';
import { rankForHours, VR_RANKS } from './ranks.js';
import { prefsOf, playerOf, tzOffset, dayKey, addDays, HOUR, walk } from './profileCore.js';
import { mk, type Achievement } from './profileAchievements.js';

// ---------- V Rising: rank ladder and achievements ----------
db.exec('CREATE TABLE IF NOT EXISTS vr_rank_max (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, hours REAL NOT NULL DEFAULT 0)');

interface VrSess { server_id: number; joined_at: number; left_at: number | null }

/** sessions of a nick on servers whose game id is vrising (the log keeps 90 days) */
function vrSessionsOf(nick: string): VrSess[] {
  if (!nick) return [];
  return db
    .prepare(
      `SELECT ps.server_id, ps.joined_at, ps.left_at FROM player_sessions ps JOIN servers s ON s.id = ps.server_id
       WHERE s.game = 'vrising' AND ulower(ps.name) = ulower(?) ORDER BY ps.joined_at`,
    )
    .all(nick) as VrSess[];
}

/** hours of play on vrising servers; never goes down (the best value seen is remembered, the log is pruned after 90 days) */
export function vrHoursOf(userId: number, nick: string): { hours: number; sessions: number } {
  if (!nick) return { hours: 0, sessions: 0 };
  const now = Date.now();
  const sess = vrSessionsOf(nick).filter((s) => (s.left_at ?? now) > s.joined_at);
  const cur = sess.reduce((a, s) => a + ((s.left_at ?? now) - s.joined_at), 0) / HOUR;
  const row = db.prepare('SELECT hours FROM vr_rank_max WHERE user_id = ?').get(userId) as { hours: number } | undefined;
  const hours = Math.max(cur, row?.hours ?? 0);
  if (hours > (row?.hours ?? 0) + 0.01) {
    db.prepare('INSERT INTO vr_rank_max (user_id, hours) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET hours = excluded.hours').run(userId, hours);
  }
  return { hours, sessions: sess.length };
}

export interface VrAchievement extends Achievement {
  game: 'vrising';
  image: string;
}

export function vrAchievementsOf(userId: number): VrAchievement[] {
  const nick = playerOf(userId).gameNick;
  const now = Date.now();
  const tz = prefsOf(userId).timezone;
  const sess = vrSessionsOf(nick).filter((s) => (s.left_at ?? now) > s.joined_at);
  const rankHours = vrHoursOf(userId, nick).hours;

  let totalMs = 0;
  let longestMs = 0;
  let firstAt: number | null = null;
  let nightAt: number | null = null;
  let sunAt: number | null = null;
  let sleeplessAt: number | null = null;
  let dawnAt: number | null = null;
  let crowdAt: number | null = null;
  let h100At: number | null = null;
  let h400At: number | null = null;
  let n50At: number | null = null;
  let count = 0;
  const perServer = new Map<number, number>();
  const dayEnd = new Map<string, number>();
  const dayMs = new Map<string, number>();
  const maxOf = new Map<number, number>();
  const crossing = (s: VrSess, end: number, hour: number): boolean => {
    const off = tzOffset(tz, s.joined_at);
    const startLocal = s.joined_at + off;
    let at = Math.floor(startLocal / 86400000) * 86400000 + hour * HOUR;
    if (at < startLocal) at += 86400000;
    return at - off < end;
  };
  for (const s of sess) {
    const end = s.left_at ?? now;
    const dur = end - s.joined_at;
    const before = totalMs;
    totalMs += dur;
    count++;
    if (h100At === null && totalMs >= 100 * HOUR) h100At = s.joined_at + Math.max(0, 100 * HOUR - before);
    if (h400At === null && totalMs >= 400 * HOUR) h400At = s.joined_at + Math.max(0, 400 * HOUR - before);
    if (n50At === null && count >= 50) n50At = s.joined_at;
    longestMs = Math.max(longestMs, dur);
    if (sleeplessAt === null && dur >= 6 * HOUR) sleeplessAt = s.joined_at + 6 * HOUR;
    firstAt ??= s.joined_at;
    perServer.set(s.server_id, (perServer.get(s.server_id) ?? 0) + dur);
    if (nightAt === null && crossing(s, end, 3)) nightAt = s.joined_at;
    if (sunAt === null && crossing(s, end, 12)) sunAt = s.joined_at;
    if (dawnAt === null && s.left_at !== null) {
      const h = new Date(end + tzOffset(tz, end)).getUTCHours();
      if (h === 5) dawnAt = end;
    }
    if (crowdAt === null) {
      let max = maxOf.get(s.server_id);
      if (max === undefined) {
        max = (db.prepare('SELECT max_players FROM status WHERE server_id = ?').get(s.server_id) as { max_players: number } | undefined)?.max_players ?? 0;
        maxOf.set(s.server_id, max);
      }
      if (max > 0) {
        const h = db
          .prepare('SELECT players FROM history WHERE server_id = ? AND ts BETWEEN ? AND ? ORDER BY ABS(ts - ?) LIMIT 1')
          .get(s.server_id, s.joined_at - 10 * 60000, s.joined_at + 10 * 60000, s.joined_at) as { players: number } | undefined;
        if (h && h.players / max >= 0.9) crowdAt = s.joined_at;
      }
    }
    walk(s.joined_at, end, tz, (local, ms, t) => {
      const k = dayKey(local);
      dayEnd.set(k, Math.max(dayEnd.get(k) ?? 0, t + ms));
      dayMs.set(k, (dayMs.get(k) ?? 0) + ms);
    });
  }
  const hours = totalMs / HOUR;
  const share = totalMs > 0 ? Math.max(0, ...perServer.values()) / totalMs : 0;
  const bestDayMs = Math.max(0, ...dayMs.values());
  let longDayAt: number | null = null;
  if (bestDayMs >= 12 * HOUR) {
    const k = [...dayMs].find(([, v]) => v >= 12 * HOUR)?.[0];
    longDayAt = k ? (dayEnd.get(k) ?? null) : null;
  }

  const keys = [...dayEnd.keys()].sort();
  let best = 0;
  let run = 0;
  let prev = '';
  let at7: number | null = null;
  let at30: number | null = null;
  for (const k of keys) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    prev = k;
    best = Math.max(best, run);
    if (run === 7 && at7 === null) at7 = dayEnd.get(k) ?? null;
    if (run === 30 && at30 === null) at30 = dayEnd.get(k) ?? null;
  }

  const u = db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId) as { created_at: number | null } | undefined;
  const first = (db.prepare('SELECT MIN(created_at) AS m FROM users WHERE created_at IS NOT NULL').get() as { m: number | null }).m;
  const founder = !!u?.created_at && first !== null && u.created_at - first <= 30 * 86400000;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const mk = (id: string, title: string, description: string, icon: string, progress: number, target: number, earnedAt: number | null = null): VrAchievement => {
    const earned = progress >= target;
    return { id, title, description, icon, earned, progress: Math.min(progress, target), target, earnedAt: earned ? earnedAt : null, game: 'vrising', image: `/vrising/achievements/${id}.png` };
  };
  const loyal = share >= 0.8 && hours >= 20;
  const crowned = rankHours >= VR_RANKS[VR_RANKS.length - 1]!.minHours;

  return [
    mk('vr-first-bite', 'Первый укус', 'Проведите первую сессию на сервере V Rising', 'star', Math.min(count, 1), 1, firstAt),
    mk('vr-night-hunter', 'Ночной охотник', 'Играйте так, чтобы сессия пересекла 03:00', 'moon', nightAt ? 1 : 0, 1, nightAt),
    mk('vr-sun-defier', 'Не боюсь солнца', 'Сессия, охватывающая полдень (12:00)', 'sun', sunAt ? 1 : 0, 1, sunAt),
    mk('vr-sleepless', 'Бессонная ночь', 'Одна сессия длиннее 6 часов', 'clock', r1(longestMs / HOUR), 6, sleeplessAt),
    mk('vr-blood-bond', 'Кровная связь', 'Играйте 7 дней подряд', 'flame', Math.min(best, 7), 7, at7),
    mk('vr-eternal', 'Вечный', 'Играйте 30 дней подряд', 'flame', Math.min(best, 30), 30, at30),
    mk('vr-castle-warden', 'Хранитель замка', 'Наиграйте 100 часов в V Rising', 'shield', r1(hours), 100, h100At),
    mk('vr-elder', 'Древний вампир', 'Наиграйте 400 часов в V Rising', 'crown', r1(hours), 400, h400At),
    mk('vr-two-realms', 'Владыка двух миров', 'Поиграйте минимум на 2 разных серверах V Rising', 'server', perServer.size, 2, perServer.size >= 2 ? now : null),
    mk('vr-loyal', 'Верный сервер', 'Проведите 80% времени на одном сервере (не менее 20 часов)', 'heart', loyal ? 100 : Math.min(99, Math.round(share * 100)), 100, loyal ? now : null),
    mk('vr-veteran-nights', '50 ночей', 'Проведите 50 игровых сессий', 'calendar', Math.min(count, 50), 50, n50At),
    mk('vr-long-haul', 'Бессмертный марафон', 'Играйте 12 часов за один календарный день', 'clock', r1(Math.min(bestDayMs, 12 * HOUR) / HOUR), 12, longDayAt),
    mk('vr-dawn-escape', 'Бегущий от рассвета', 'Закончите сессию между 05:00 и 06:00', 'sun', dawnAt ? 1 : 0, 1, dawnAt),
    mk('vr-crowd-lord', 'Лорд толпы', 'Зайдите на сервер, когда он заполнен на 90% и больше', 'server', crowdAt ? 1 : 0, 1, crowdAt),
    mk('vr-founder', 'Основатель', 'Аккаунт создан в первые 30 дней работы панели', 'star', founder ? 1 : 0, 1, founder ? (u?.created_at ?? null) : null),
    mk('vr-crowned', 'Коронованный', 'Достигните ранга «Первородный»', 'crown', crowned ? 1 : 0, 1, crowned ? now : null),
  ];
}

// ---------- public ranks of the players currently on a server ----------
let rankCache: { at: number; map: Map<string, number> } | null = null;
/** lower(name) -> hours of play on vrising servers, cached for 60 s */
export function vrHoursByName(): Map<string, number> {
  const now = Date.now();
  if (rankCache && now - rankCache.at < 60_000) return rankCache.map;
  const rows = db
    .prepare(
      `SELECT ulower(ps.name) AS n, SUM(COALESCE(ps.left_at, ?) - ps.joined_at) AS ms
       FROM player_sessions ps JOIN servers s ON s.id = ps.server_id
       WHERE s.game = 'vrising' AND COALESCE(ps.left_at, ?) > ps.joined_at GROUP BY ulower(ps.name)`,
    )
    .all(now, now) as { n: string; ms: number }[];
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.n, r.ms / HOUR);
  rankCache = { at: now, map };
  return map;
}
export function vrRankIdFor(name: string): string {
  return rankForHours(vrHoursByName().get(name.toLowerCase()) ?? 0).id;
}

