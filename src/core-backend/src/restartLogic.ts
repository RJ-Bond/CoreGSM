/** When a scheduled restart happens, and the game chat command for its warning (pure, no database). */
import { localParts, zonedTime } from './localTime.js';

/** the next restart at or after `from` (a week ahead at most), or null when no day is ticked */
export function nextRun(p: { days: number; at_min: number }, from: number, zone: string): number | null {
  if (!(p.days & 127)) return null;
  for (let k = 0; k <= 8; k++) {
    const parts = localParts(from + k * 86_400_000, zone);
    if (!(p.days & (1 << parts.dow))) continue;
    const t = zonedTime(parts.day, p.at_min, zone);
    if (t >= from) return t;
  }
  return null;
}

/** the game chat command that fits a game best (the admin can change it) */
export function defaultSay(game: string): string {
  if (game === 'vrising') return 'announce {text}';
  if (game === 'ase' || game === 'asa') return 'ServerChat {text}';
  if (game === 'palworld') return 'Broadcast {text}';
  return 'say {text}';
}

