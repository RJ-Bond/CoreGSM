/** The live card of a giveaway: the line with the number of participants, kept fresh by the bot on every press. Pure. */

const LINE = /^👥 Участников: \*\*\d+\*\*$/m;

/** the description with the participants line set to `n` (added at the end when it is not there yet) */
export function withParticipants(description: string, n: number): string {
  const line = `👥 Участников: **${n}**`;
  return LINE.test(description) ? description.replace(LINE, line) : `${description}\n${line}`;
}

/** edits of one message are limited by Discord: no more often than every `gap` ms */
export function mayEdit(last: Map<string, number>, key: string, now: number, gap = 4000): boolean {
  const t = last.get(key);
  if (t !== undefined && now - t < gap) return false;
  last.set(key, now);
  if (last.size > 300) for (const [k, v] of last) if (now - v > gap) last.delete(k);
  return true;
}
