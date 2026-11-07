/**
 * The game chat for Discord, the parts that need no database: the kinds of chat, the stored settings, the check of a
 * webhook address, and how a line is written so that nothing a player types can ping anybody or break the formatting.
 */

export const CHAT_KINDS = ['global', 'clan', 'local'] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

/** one webhook for the whole chat (kept encrypted) and a switch for every kind of chat */
export interface ChatStored { enabled: boolean; webhook: string; kinds: Record<ChatKind, boolean> }

/**
 * The stored setting as a ChatStored. An older setting had one webhook per kind of chat: the first webhook that was set
 * becomes the only one and the kinds that had a webhook stay on.
 */
export function normalizeChat(raw: unknown): ChatStored {
  const v = (raw && typeof raw === 'object' ? raw : {}) as {
    enabled?: unknown; webhook?: unknown; kinds?: Partial<Record<ChatKind, unknown>>; webhooks?: Partial<Record<ChatKind, unknown>>;
  };
  const legacy = v.webhooks && typeof v.webhooks === 'object' ? v.webhooks : {};
  const legacyFirst = CHAT_KINDS.map((k) => legacy[k]).find((x): x is string => typeof x === 'string' && x.length > 0);
  const webhook = typeof v.webhook === 'string' && v.webhook ? v.webhook : legacyFirst ?? '';
  const kinds = {} as Record<ChatKind, boolean>;
  for (const k of CHAT_KINDS) {
    if (v.kinds && typeof v.kinds[k] === 'boolean') kinds[k] = v.kinds[k] as boolean;
    else kinds[k] = v.webhooks ? typeof legacy[k] === 'string' && !!legacy[k] : true;
  }
  return { enabled: !!v.enabled, webhook, kinds };
}

/** the kinds that are forwarded right now: the switch is on, a webhook is set and the kind is not turned off */
export function activeChatKinds(s: ChatStored): ChatKind[] {
  return s.enabled && s.webhook ? CHAT_KINDS.filter((k) => s.kinds[k]) : [];
}

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
