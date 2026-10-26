/** Achievements derived from the player sessions log. */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, db } from './db.js';
import { prefsOf, playerOf, tzOffset, dayKey, addDays, HOUR, RETAIN_DAYS, sessionsOf, walk } from './profileCore.js';

// ---------- achievements ----------
export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  earned: boolean;
  progress: number;
  target: number;
  earnedAt: number | null;
}



/**
 * The achievements earned by playing (hours, streaks, night and morning sessions, servers), from the visits of one
 * player. Shared by the account's profile and the public card of any nick.
 */
export function playAchievements(visits: { server_id: number; joined_at: number; left_at: number | null }[], tz: string, now = Date.now()): Achievement[] {
  const sess = visits.filter((s) => (s.left_at ?? now) > s.joined_at).sort((x, y) => x.joined_at - y.joined_at);

  let totalMs = 0;
  let longestMs = 0;
  let firstAt: number | null = null;
  let nightAt: number | null = null;
  let earlyAt: number | null = null;
  let marathonAt: number | null = null;
  let h10At: number | null = null;
  let h100At: number | null = null;
  const perServer = new Map<number, number>();
  const dayEnd = new Map<string, number>(); // local day -> last instant played on it
  for (const s of sess) {
    const end = s.left_at ?? now;
    const dur = end - s.joined_at;
    const before = totalMs;
    totalMs += dur;
    if (h10At === null && totalMs >= 10 * HOUR) h10At = s.joined_at + Math.max(0, 10 * HOUR - before);
    if (h100At === null && totalMs >= 100 * HOUR) h100At = s.joined_at + Math.max(0, 100 * HOUR - before);
    longestMs = Math.max(longestMs, dur);
    if (marathonAt === null && dur >= 4 * HOUR) marathonAt = s.joined_at + 4 * HOUR;
    firstAt ??= s.joined_at;
    perServer.set(s.server_id, (perServer.get(s.server_id) ?? 0) + dur);
    // local 03:00 inside the session, and a start between 05:00 and 08:00
    const off = tzOffset(tz, s.joined_at);
    const startLocal = s.joined_at + off;
    const startHour = new Date(startLocal).getUTCHours();
    if (earlyAt === null && startHour >= 5 && startHour < 8) earlyAt = s.joined_at;
    if (nightAt === null) {
      const dayStart = Math.floor(startLocal / 86400000) * 86400000;
      let three = dayStart + 3 * HOUR;
      if (three <= startLocal) three += 86400000;
      if (three - off < end) nightAt = s.joined_at;
    }
    walk(s.joined_at, end, tz, (local, _ms, t) => {
      const k = dayKey(local);
      dayEnd.set(k, Math.max(dayEnd.get(k) ?? 0, t + _ms));
    });
  }
  const hours = totalMs / HOUR;
  const topMs = Math.max(0, ...perServer.values());
  const share = totalMs > 0 ? topMs / totalMs : 0;

  // best run of consecutive days with play
  const keys = [...dayEnd.keys()].sort();
  let best = 0;
  let run = 0;
  let prev = '';
  let at3: number | null = null;
  let at7: number | null = null;
  for (const k of keys) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    prev = k;
    best = Math.max(best, run);
    if (run === 3 && at3 === null) at3 = dayEnd.get(k) ?? null;
    if (run === 7 && at7 === null) at7 = dayEnd.get(k) ?? null;
  }

  const r1 = (n: number) => Math.round(n * 10) / 10;
  const domosedEarned = share >= 0.8 && hours >= 10;

  return [
    mk('first-step', 'Первый шаг', 'Проведите первую игровую сессию на отслеживаемом сервере', 'star', Math.min(sess.length, 1), 1, firstAt),
    mk('hours-10', '10 часов', 'Наиграйте 10 часов суммарно', 'clock', r1(hours), 10, h10At),
    mk('hours-100', '100 часов', 'Наиграйте 100 часов суммарно', 'clock', r1(hours), 100, h100At),
    mk('night-shift', 'Ночная смена', 'Играйте так, чтобы сессия пересекла 03:00', 'moon', nightAt ? 1 : 0, 1, nightAt),
    mk('early-bird', 'Ранняя пташка', 'Зайдите в игру между 05:00 и 08:00', 'sun', earlyAt ? 1 : 0, 1, earlyAt),
    mk('streak-3', 'Серия 3 дня', 'Играйте 3 дня подряд', 'flame', Math.min(best, 3), 3, at3),
    mk('streak-7', 'Серия 7 дней', 'Играйте 7 дней подряд', 'flame', Math.min(best, 7), 7, at7),
    mk('homebody', 'Домосед', 'Проведите 80% времени на одном сервере (не менее 10 часов всего)', 'heart', domosedEarned ? 100 : Math.min(99, Math.round(share * 100)), 100, domosedEarned ? now : null),
    mk('traveller', 'Путешественник', 'Поиграйте на 3 разных серверах', 'server', perServer.size, 3, perServer.size >= 3 ? now : null),
    mk('marathon', 'Марафонец', 'Одна сессия длиннее 4 часов', 'crown', r1(longestMs / HOUR), 4, marathonAt),
  ];
}

export const mk = (id: string, title: string, description: string, icon: string, progress: number, target: number, earnedAt: number | null = null): Achievement => {
  const earned = progress >= target;
  return { id, title, description, icon, earned, progress: Math.min(progress, target), target, earnedAt: earned ? earnedAt : null };
};

export function achievementsOf(userId: number): Achievement[] {
  const nick = playerOf(userId).gameNick;
  const now = Date.now();
  const tz = prefsOf(userId).timezone;
  const play = playAchievements(sessionsOf(userId, nick, now - RETAIN_DAYS * 86400000), tz, now);
  const u = db.prepare('SELECT email, no_password, discord_id FROM users WHERE id = ?').get(userId) as { email: string | null; no_password: number; discord_id: string | null } | undefined;
  const hasAvatar = fs.existsSync(path.join(DATA_DIR, 'avatars', `${userId}.png`)) || !!db.prepare('SELECT 1 FROM users WHERE id = ? AND discord_avatar IS NOT NULL').get(userId);
  const profileParts = [hasAvatar, !!u?.email, !!nick].filter(Boolean).length;
  const protectedParts = [!u?.no_password, !!u?.email, !!u?.discord_id].filter(Boolean).length;
  return [
    ...play,
    mk('profile-complete', 'Профиль заполнен', 'Аватар, электронная почта и игровой ник', 'calendar', profileParts, 3),
    mk('secured', 'Защищён', 'Пароль, электронная почта и привязанный Discord', 'shield', protectedParts, 3),
  ];
}

