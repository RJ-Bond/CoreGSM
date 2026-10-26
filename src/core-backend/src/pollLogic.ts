/** Community polls: validation, counting and text. Pure, covered by tests. */
export const MAX_OPTIONS = 10;
export const MIN_OPTIONS = 2;

export interface PollInput { question: string; options: string[]; closesAt?: number | null }

export function validatePoll(i: PollInput, now: number): { ok: true; question: string; options: string[]; closesAt: number | null } | { ok: false; error: 'poll_invalid' } {
  const question = i.question.trim();
  const options = i.options.map((o) => o.trim()).filter(Boolean);
  const unique = new Set(options.map((o) => o.toLowerCase()));
  if (question.length < 3 || question.length > 200) return { ok: false, error: 'poll_invalid' };
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS || unique.size !== options.length || options.some((o) => o.length > 80)) return { ok: false, error: 'poll_invalid' };
  const closesAt = i.closesAt ?? null;
  if (closesAt !== null && (!Number.isFinite(closesAt) || closesAt <= now)) return { ok: false, error: 'poll_invalid' };
  return { ok: true, question, options, closesAt };
}

export const pollIsOpen = (p: { closed: boolean; closesAt: number | null }, now: number): boolean => !p.closed && (p.closesAt === null || p.closesAt > now);

export interface TallyRow { id: number; text: string; votes: number; pct: number }
export function tally(options: { id: number; text: string }[], counts: Map<number, number>): { rows: TallyRow[]; total: number } {
  const total = options.reduce((n, o) => n + (counts.get(o.id) ?? 0), 0);
  return { total, rows: options.map((o) => ({ id: o.id, text: o.text, votes: counts.get(o.id) ?? 0, pct: total ? Math.round(((counts.get(o.id) ?? 0) / total) * 100) : 0 })) };
}

const bar = (pct: number) => '▰'.repeat(Math.round(pct / 10)) + '▱'.repeat(10 - Math.round(pct / 10));

/** «▰▰▰▰▱▱▱▱▱▱ 40% · Вариант (4)» for every option */
export function resultsText(rows: TallyRow[], total: number): string {
  const lines = rows.map((r) => `${bar(r.pct)} **${r.pct}%** · ${r.text.replace(/[*_~`|>]/g, '')} (${r.votes})`);
  return `${lines.join('\n')}\n\nВсего голосов: **${total}**`;
}
