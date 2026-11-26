/** «Моя неделя»: the last seven days of a player against the seven before them. */

export interface DaySeconds { date: string; seconds: number }
export interface AchievementLike { earned: boolean; earnedAt?: number | null }

export interface Week {
  hours: number;
  /** hours of the seven days before */
  before: number;
  /** days with at least a minute in the game */
  days: number;
  best: { date: string; hours: number } | null;
  achievements: number;
  /** the hours of each of the seven days, oldest first */
  bars: number[];
}

const DAY = 86_400_000;
const hoursOf = (s: number) => Math.round((s / 3600) * 10) / 10;

/** `byDay` is oldest first, as the card of a player gives it; null when nothing was played in these two weeks */
export function weekOf(byDay: DaySeconds[], achievements: AchievementLike[] = [], now = Date.now()): Week | null {
  const last = byDay.slice(-7);
  const prev = byDay.slice(-14, -7);
  const sum = (list: DaySeconds[]) => list.reduce((a, d) => a + d.seconds, 0);
  if (sum(last) + sum(prev) < 60) return null;
  const top = last.reduce<DaySeconds | null>((m, d) => (d.seconds >= 60 && (!m || d.seconds > m.seconds) ? d : m), null);
  return {
    hours: hoursOf(sum(last)),
    before: hoursOf(sum(prev)),
    days: last.filter((d) => d.seconds >= 60).length,
    best: top ? { date: top.date, hours: hoursOf(top.seconds) } : null,
    achievements: achievements.filter((a) => a.earned && a.earnedAt != null && now - a.earnedAt <= 7 * DAY).length,
    bars: last.map((d) => hoursOf(d.seconds)),
  };
}
