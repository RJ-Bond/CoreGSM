/**
 * The game chat for Discord, the parts that need no database: the kinds of chat, the check of a webhook address, and how
 * a line is written so that nothing a player types can ping anybody or break the formatting.
 */

export const CHAT_KINDS = ['global', 'clan', 'local'] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

/** only a real Discord webhook address is accepted */
export const isDiscordWebhook = (u: string): boolean =>
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{15,25}\/[\w-]{20,120}$/.test(u.trim());

/** a player's text made harmless for Discord: no markdown, no mentions, no control characters */
export function escapeDiscord(text: string): string {
  const flat = Array.from(text, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('');
  return flat
    .replace(/[\\*_~|`>#<]/g, (c) => `\\${c}`)
    .replace(/@/g, '@​')
    .replace(/ {2,}/g, ' ')
    .trim();
}

const CHAT_LABEL: Record<ChatKind, string> = { global: 'Общий', clan: 'Клан', local: 'Рядом' };

/** «**[Общий]** **WhiteLegioN**: Тест»; '' for what must not be forwarded (a command, an empty text) */
export function formatChatLine(kind: ChatKind, name: string, clan: string, text: string, server = ''): string {
  const t = text.trim();
  if (!t || t.startsWith('.') || t.startsWith('/') || t.startsWith('!')) return '';
  const tag = kind === 'clan' && clan.trim() ? `${CHAT_LABEL.clan} ${clan.trim()}` : CHAT_LABEL[kind];
  const head = server ? `**[${escapeDiscord(server)}]** ` : '';
  return `${head}**[${escapeDiscord(tag)}]** **${escapeDiscord(name.trim() || '?')}**: ${escapeDiscord(t).slice(0, 500)}`;
}

/** lines joined into messages that fit Discord (2000 characters, kept below it) */
export function chunkLines(lines: string[], max = 1900): string[] {
  const out: string[] = [];
  let cur = '';
  for (const raw of lines) {
    const l = raw.length > max ? raw.slice(0, max) : raw;
    if (cur && cur.length + 1 + l.length > max) {
      out.push(cur);
      cur = l;
    } else {
      cur = cur ? `${cur}\n${l}` : l;
    }
  }
  if (cur) out.push(cur);
  return out;
}
