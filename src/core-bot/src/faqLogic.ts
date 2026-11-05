/** FAQ in the bot: the question out of a message that mentions the bot, and the per-channel pause between answers. Pure. */

/** the text of the message without mentions of the bot; null when it is not a question for the bot */
export function mentionQuestion(content: string, botId: string): string | null {
  const re = new RegExp(`<@!?${botId}>`, 'g');
  if (!re.test(content)) return null;
  const q = content.replace(new RegExp(`<@!?${botId}>`, 'g'), ' ').replace(/\s+/g, ' ').trim();
  return q.length >= 3 ? q.slice(0, 300) : null;
}

export const FAQ_PAUSE_MS = 20_000;

/** true when the channel may get an answer now; remembers the time (and forgets old channels) */
export function faqAllowed(last: Map<string, number>, channelId: string, now: number, pause = FAQ_PAUSE_MS): boolean {
  const t = last.get(channelId);
  if (t !== undefined && now - t < pause) return false;
  last.set(channelId, now);
  if (last.size > 500) for (const [k, v] of last) if (now - v > pause) last.delete(k);
  return true;
}
