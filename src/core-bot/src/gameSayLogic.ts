/** What the bot shows for a line that goes from Discord into the game chat: the mark under the message, the card, the line in the channel. */

export type SayStatus = 'sent' | 'empty' | 'rate' | 'denied' | 'error';

export interface SayAnswer {
  ok: boolean;
  status: SayStatus;
  text: string;
  silent?: boolean;
  ids?: number[];
  servers?: { name: string; players: number | null }[];
  ansi?: string;
  confirm?: { card: boolean; line: boolean };
}

/** the mark under the message at once: 👀 accepted (waits for the game), 📭 nobody is in the game, ⏳ too often, ❌ did not work */
export const markFor = (s: SayStatus): string => (s === 'sent' ? '👀' : s === 'empty' ? '📭' : s === 'rate' ? '⏳' : '❌');

/** the mark when the game has shown the line (🎮) or could not (❌) */
export const doneMark = (delivered: boolean): string => (delivered ? '🎮' : '❌');

const ESC = String.fromCharCode(27);
const gray = (t: string): string => `${ESC}[0;30m${t}${ESC}[0m`;

/** the line in the channel in the style of the chat: «→ в игру» in grey, then the line as it stands in the game */
export const channelLine = (ansi: string): string => `\`\`\`ansi\n${gray('→ в игру ')}${ansi}\n\`\`\``;

/** the card under the message: the line as it will look in the game, where it went, how many players are there */
export function cardText(a: SayAnswer): { description: string; where: string } {
  const servers = a.servers ?? [];
  const where = servers.map((s) => (s.players != null ? `${s.name} · ${s.players}` : s.name)).join('\n') || '—';
  return { description: a.ansi ? `\`\`\`ansi\n${a.ansi}\n\`\`\`` : a.text, where };
}
