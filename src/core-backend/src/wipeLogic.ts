/** Texts of the wipe scenario (pure, no database). */

/** «24 ч», «1 ч 30 мин», «10 мин» */
export function leadText(min: number): string {
  if (min >= 1440 && min % 1440 === 0) return `${min / 1440} дн`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
}

/** {server}, {date}, {time}, {seed} in the texts of the scenario */
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(server|date|time|seed)\}/g, (_, k: string) => vars[k] ?? '');
}
