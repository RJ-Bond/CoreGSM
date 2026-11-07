/**
 * A countdown in the game chat before a planned restart (the restart plans of monitoring/restarts.ts):
 * «через 10 / 5 / 1 минуту». It goes to the servers that have the game plugin and only while someone is playing.
 * The switch is the setting `gamenews_restart_countdown` ('0' = off, anything else = on).
 */
import { db, getSetting } from '../db.js';
import { log } from '../logger.js';
import { queueNews } from './gameNews.js';

export const COUNTDOWN_STEPS = [10, 5, 1];
const MIN = 60_000;
const fired = new Set<string>();

/** the step whose last minute `msLeft` is in (10 for 9-10 minutes left), or null */
export function countdownStep(msLeft: number): number | null {
  for (const s of COUNTDOWN_STEPS) if (msLeft <= s * MIN && msLeft > (s - 1) * MIN) return s;
  return null;
}

export const countdownEnabled = (): boolean => getSetting('gamenews_restart_countdown') !== '0';

const minutes = (n: number): string => (n === 1 ? '1 минуту' : `${n} минут`);
export const countdownText = (n: number): string => `<color=#FFCC33><b>Перезапуск сервера через ${minutes(n)}.</b></color> Сохраните прогресс.`;

/** called on every pass of the restart scheduler for a server whose next restart is at `nextTs` */
export function announceRestart(serverId: number, nextTs: number, now: number): void {
  if (!countdownEnabled()) return;
  const step = countdownStep(nextTs - now);
  if (step == null) return;
  const key = `${serverId}:${nextTs}:${step}`;
  if (fired.has(key)) return;
  fired.add(key);
  if (fired.size > 200) fired.clear();
  try {
    // no plugin on this server: nothing to say (and no «failed» row in the history)
    if (!db.prepare("SELECT 1 FROM game_news_targets WHERE server_id = ? AND token_hash <> ''").get(serverId)) return;
    queueNews(countdownText(step), [serverId], 'авто: рестарт', now, { onlyOnline: true });
  } catch (e) {
    // the announcement must never break the restart schedule
    log.error('game news countdown failed', (e as Error).message);
  }
}
