import { nextRank, rankForHours } from '../profile/ranks.js';

/** «Ник, ваш ранг: …»: the rank of a player by his hours of play, with the distance to the next one */
export function rankLine(text: string, name: string, hours: number): string {
  const r = rankForHours(hours);
  const nx = nextRank(hours);
  const next = nx ? ` · до «${nx.name}» ещё ${Math.max(1, Math.ceil(nx.minHours - hours))} ч` : ' · высший ранг';
  const h = hours >= 10 ? String(Math.floor(hours)) : String(Math.floor(hours * 10) / 10);
  const plain = name.replace(/[<>]/g, '').trim();
  return text.replace(/\{name\}/g, plain).replace(/\{rank\}/g, r.name).replace(/\{hours\}/g, h).replace(/\{next\}/g, next);
}
