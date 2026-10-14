/**
 * V Rising rank ladder. Hours of play on servers whose game id is `vrising`.
 * KEEP IN SYNC with src/core-frontend/src/vrisingRanks.ts (a test compares the id/minHours lists).
 */
export interface VrRank {
  id: string;
  name: string;
  minHours: number;
  color: string;
  image: string;
}

export const VR_RANKS: readonly VrRank[] = [
  { id: 'awakened', name: 'Пробуждённый', minHours: 0, color: '#9ca3af', image: '/vrising/ranks/rank-1-awakened.png' },
  { id: 'wanderer', name: 'Ночной скиталец', minHours: 5, color: '#9b1c31', image: '/vrising/ranks/rank-2-wanderer.png' },
  { id: 'hunter', name: 'Охотник на кровь', minHours: 20, color: '#dc2626', image: '/vrising/ranks/rank-3-hunter.png' },
  { id: 'warden', name: 'Страж замка', minHours: 50, color: '#9f1239', image: '/vrising/ranks/rank-4-warden.png' },
  { id: 'baron', name: 'Барон тьмы', minHours: 100, color: '#7c3aed', image: '/vrising/ranks/rank-5-baron.png' },
  { id: 'lord', name: 'Кровавый лорд', minHours: 200, color: '#a855f7', image: '/vrising/ranks/rank-6-lord.png' },
  { id: 'elder', name: 'Древний', minHours: 400, color: '#d4af37', image: '/vrising/ranks/rank-7-elder.png' },
  { id: 'progenitor', name: 'Первородный', minHours: 800, color: '#f5b01e', image: '/vrising/ranks/rank-8-progenitor.png' },
];

export function rankForHours(hours: number): VrRank {
  let r = VR_RANKS[0];
  for (const x of VR_RANKS) if (hours >= x.minHours) r = x;
  return r;
}

export function nextRank(hours: number): VrRank | null {
  return VR_RANKS.find((x) => x.minHours > hours) ?? null;
}

/** 0..1 towards the next rank (1 at the top) */
export function rankProgress(hours: number): number {
  const cur = rankForHours(hours);
  const nx = nextRank(hours);
  if (!nx) return 1;
  return Math.max(0, Math.min(1, (hours - cur.minHours) / (nx.minHours - cur.minHours)));
}

export function rankById(id: string): VrRank | undefined {
  return VR_RANKS.find((x) => x.id === id);
}
