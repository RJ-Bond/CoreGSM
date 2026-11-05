/** Giveaways: who may join and a fair draw. Pure (the randomness is passed in). */

export interface Conditions { roleId: string; minHours: number }
export interface Joiner { roles: string[]; hours: number | null }

/** null = may join; otherwise why not */
export function joinProblem(c: Conditions, j: Joiner): 'role' | 'unlinked' | 'hours' | null {
  if (c.roleId && !j.roles.includes(c.roleId)) return 'role';
  if (c.minHours > 0) {
    if (j.hours === null) return 'unlinked';
    if (j.hours < c.minHours) return 'hours';
  }
  return null;
}

/**
 * `count` different winners out of `pool` without the ones in `skip` (Fisher–Yates with the given random function:
 * rnd(n) returns an integer in [0, n)).
 */
export function draw(pool: string[], count: number, rnd: (n: number) => number, skip: string[] = []): string[] {
  const bad = new Set(skip);
  const a = [...new Set(pool)].filter((x) => !bad.has(x));
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, Math.max(0, count));
}

export function validateGiveaway(o: { prize: string; winners: number; hours: number; minHours?: number }): string | null {
  if (o.prize.trim().length < 2 || o.prize.length > 200) return 'Приз — от 2 до 200 символов';
  if (!Number.isInteger(o.winners) || o.winners < 1 || o.winners > 20) return 'Победителей — от 1 до 20';
  if (!(o.hours >= 0.05) || o.hours > 24 * 30) return 'Длительность — от 3 минут до 30 дней';
  if ((o.minHours ?? 0) < 0 || (o.minHours ?? 0) > 100000) return 'Минимум часов — от 0';
  return null;
}
