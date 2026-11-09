import { nextRank, rankForHours } from '../profile/ranks.js';

export interface RankParts { rank: string; color: string; hours: string; next: string }

/** the parts of the rank line of a player by his hours of play: the rank (and its colour), the hours, the way to the next one */
export function rankParts(hours: number): RankParts {
  const r = rankForHours(hours);
  const nx = nextRank(hours);
  const next = nx ? ` · до «${nx.name}» ещё ${Math.max(1, Math.ceil(nx.minHours - hours))} ч` : ' · высший ранг';
  const h = hours >= 10 ? String(Math.floor(hours)) : String(Math.floor(hours * 10) / 10);
  return { rank: r.name, color: r.color, hours: h, next };
}

/** «Ник, ваш ранг: …»: the rank of a player by his hours of play, with the distance to the next one */
export function rankLine(text: string, name: string, hours: number): string {
  const p = rankParts(hours);
  const plain = name.replace(/[<>]/g, '').trim();
  return text.replace(/\{name\}/g, plain).replace(/\{rank\}/g, p.rank).replace(/\{hours\}/g, p.hours).replace(/\{next\}/g, p.next);
}
