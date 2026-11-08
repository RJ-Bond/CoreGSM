/**
 * The game chat for Discord, the parts that need no database: the kinds of chat, the stored settings, the check of a
 * webhook address, and how a line is written (coloured like in the game, or plain) so that nothing a player types can
 * ping anybody or break the formatting.
 *
 * Discord cannot colour ordinary text, but a code block marked «ansi» shows eight colours, so a line can look like in
 * the game: a blue tag, a yellow nickname, a green clan chat.
 */

/** the kinds of line that can go to Discord: three chats and three events (a player joined, left, was kicked) */
export const CHAT_KINDS = ['global', 'clan', 'local', 'join', 'leave', 'kick'] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

/** the eight colours of an ansi block of Discord */
export const ANSI_COLORS = ['gray', 'red', 'green', 'yellow', 'blue', 'pink', 'cyan', 'white'] as const;
export type AnsiColor = (typeof ANSI_COLORS)[number];
const ANSI_CODE: Record<AnsiColor, number> = { gray: 30, red: 31, green: 32, yellow: 33, blue: 34, pink: 35, cyan: 36, white: 37 };

/** the colour of the tag («[Глобальный]»), of the nickname and of the text; for an event the tag is not used */
export interface ChatColors { tag: AnsiColor; name: AnsiColor; text: AnsiColor }
export type ChatStyle = 'ansi' | 'plain';

/** like the chat of the game: blue, a yellow nickname; the clan chat is green; a join is a purple nickname in green text */
export const DEFAULT_COLORS: Record<ChatKind, ChatColors> = {
  global: { tag: 'blue', name: 'yellow', text: 'blue' },
  local: { tag: 'blue', name: 'yellow', text: 'blue' },
  clan: { tag: 'green', name: 'yellow', text: 'green' },
  join: { tag: 'green', name: 'pink', text: 'green' },
  leave: { tag: 'green', name: 'pink', text: 'green' },
  // a kick: the text red, the nickname green, the reason (the «tag» colour) yellow
  kick: { tag: 'yellow', name: 'green', text: 'red' },
};

/** the defaults of the first version: a setting that still holds exactly them has not been changed by anybody and moves to the new ones */
const OLD_DEFAULTS: Record<ChatKind, ChatColors> = {
  global: { tag: 'blue', name: 'yellow', text: 'cyan' },
  local: { tag: 'blue', name: 'yellow', text: 'cyan' },
  clan: { tag: 'green', name: 'green', text: 'green' },
  join: { tag: 'green', name: 'pink', text: 'green' },
  leave: { tag: 'green', name: 'pink', text: 'green' },
  kick: { tag: 'yellow', name: 'green', text: 'red' },
};
const sameColors = (x: ChatColors, y: ChatColors): boolean => x.tag === y.tag && x.name === y.name && x.text === y.text;

/** one webhook for the whole chat (kept encrypted), a switch for every kind, how lines look */
export interface ChatStored {
  enabled: boolean;
  webhook: string;
  kinds: Record<ChatKind, boolean>;
  style: ChatStyle;
  /** the name the messages are posted under; '' = the name and the picture of the webhook itself */
  senderName: string;
  /** «[16:07]» in front of every line, like in the game */
  showTime: boolean;
  colors: Record<ChatKind, ChatColors>;
  /** what an administrator writes in the channel of the webhook is shown in the game chat */
  fromDiscord: boolean;
  /** the channel of the webhook (found when the webhook is saved): where the bot listens */
  channelId: string;
  /** a short card under the line an administrator wrote (where it went, how many players are there, how it looks in the game) */
  confirmCard: boolean;
  /** the line is repeated in the channel in the style of the chat («→ в игру»), so the talk reads in one row */
  confirmLine: boolean;
}

const isAnsi = (x: unknown): x is AnsiColor => typeof x === 'string' && (ANSI_COLORS as readonly string[]).includes(x);

/**
 * The stored setting as a ChatStored. An older setting had one webhook per kind of chat: the first webhook that was set
 * becomes the only one and the chats that had a webhook stay on. The events (join, leave) are off until they are switched on.
 */
export function normalizeChat(raw: unknown): ChatStored {
  const v = (raw && typeof raw === 'object' ? raw : {}) as {
    enabled?: unknown; webhook?: unknown; kinds?: Partial<Record<ChatKind, unknown>>; webhooks?: Partial<Record<ChatKind, unknown>>;
    style?: unknown; senderName?: unknown; showTime?: unknown; fromDiscord?: unknown; channelId?: unknown; confirmCard?: unknown; confirmLine?: unknown; colors?: Partial<Record<ChatKind, Partial<Record<keyof ChatColors, unknown>>>>;
  };
  const legacy = v.webhooks && typeof v.webhooks === 'object' ? v.webhooks : {};
  const legacyFirst = (['global', 'clan', 'local'] as const).map((k) => legacy[k]).find((x): x is string => typeof x === 'string' && x.length > 0);
  const webhook = typeof v.webhook === 'string' && v.webhook ? v.webhook : legacyFirst ?? '';
  const kinds = {} as Record<ChatKind, boolean>;
  const colors = {} as Record<ChatKind, ChatColors>;
  for (const k of CHAT_KINDS) {
    const event = k === 'join' || k === 'leave';
    if (v.kinds && typeof v.kinds[k] === 'boolean') kinds[k] = v.kinds[k] as boolean;
    else if (k === 'kick') kinds[k] = true; // a kick is shown by default, like a chat (an event of a player is opt-in)
    else if (event) kinds[k] = false;
    else kinds[k] = v.webhooks ? typeof legacy[k] === 'string' && !!legacy[k] : true;
    const c = v.colors?.[k] ?? {};
    const mine: ChatColors = {
      tag: isAnsi(c.tag) ? c.tag : DEFAULT_COLORS[k].tag,
      name: isAnsi(c.name) ? c.name : DEFAULT_COLORS[k].name,
      text: isAnsi(c.text) ? c.text : DEFAULT_COLORS[k].text,
    };
    colors[k] = sameColors(mine, OLD_DEFAULTS[k]) ? DEFAULT_COLORS[k] : mine;
  }
  return {
    enabled: !!v.enabled,
    webhook,
    kinds,
    style: v.style === 'plain' ? 'plain' : 'ansi',
    showTime: v.showTime !== false,
    fromDiscord: v.fromDiscord === true,
    confirmCard: v.confirmCard !== false,
    confirmLine: v.confirmLine !== false,
    channelId: typeof v.channelId === 'string' && /^\d{5,30}$/.test(v.channelId) ? v.channelId : '',
    senderName: typeof v.senderName === 'string' ? v.senderName.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80) : '',
    colors,
  };
}

/** the kinds that are forwarded right now: the switch is on, a webhook is set and the kind is not turned off */
export function activeChatKinds(s: ChatStored): ChatKind[] {
  return s.enabled && s.webhook ? CHAT_KINDS.filter((k) => s.kinds[k]) : [];
}

/** only a real Discord webhook address is accepted */
export const isDiscordWebhook = (u: string): boolean =>
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{15,25}\/[\w-]{20,120}$/.test(u.trim());

const noControl = (text: string): string => Array.from(text, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('');

/** a player's text made harmless for Discord: no markdown, no mentions, no control characters */
export function escapeDiscord(text: string): string {
  return noControl(text)
    .replace(/[\\*_~|`>#<]/g, (c) => `\\${c}`)
    .replace(/@/g, '@​')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** a player's text for inside a code block: nothing in a code block is formatted, only the block itself must not be closed */
function forBlock(text: string): string {
  return noControl(text).replace(/`{3,}/g, "'''").replace(/ {2,}/g, ' ').trim();
}

export const CHAT_LABEL: Record<'global' | 'clan' | 'local', string> = { global: 'Глобальный', clan: 'Клан', local: 'Локальный' };

const isCommand = (t: string): boolean => t.startsWith('.') || t.startsWith('/') || t.startsWith('!');

/** «[16:07] » in front of a line, like the chat of the game; '' when no time is given */
const stamp = (time: string): string => (time ? `[${noControl(time).trim()}] ` : '');

/** «[16:07] **[«Глобальный»]** **WhiteLegioN**: Тест»; '' for what must not be forwarded (a command, an empty text) */
export function formatChatLine(kind: 'global' | 'clan' | 'local', name: string, clan: string, text: string, server = '', time = ''): string {
  const t = text.trim();
  if (!t || isCommand(t)) return '';
  const tag = kind === 'clan' && clan.trim() ? `${CHAT_LABEL.clan} ${clan.trim()}` : CHAT_LABEL[kind];
  const head = server ? `**[${escapeDiscord(server)}]** ` : '';
  return `${stamp(time)}${head}**[«${escapeDiscord(tag)}»]** **${escapeDiscord(name.trim() || '?')}**: ${escapeDiscord(t).slice(0, 500)}`;
}

/** «[16:07] * Игрок **WhiteLegioN** подключился к серверу.» for a join or a leave in the plain style */
export function formatEventLine(template: string, name: string, server = '', time = ''): string {
  const head = server ? `**[${escapeDiscord(server)}]** ` : '';
  const nick = `**${escapeDiscord(name.trim() || '?')}**`;
  const [before, ...rest] = escapeDiscord(template).split('{name}');
  return `${stamp(time)}${head}${before}${rest.length ? `${nick}${rest.join(nick)}` : ''}`.trim();
}

const ESC = String.fromCharCode(27);
const seg = (color: AnsiColor, text: string, bold = false): string => (text ? `${ESC}[${bold ? 1 : 0};${ANSI_CODE[color]}m${text}${ESC}[0m` : '');

/** the eight colours of an ansi block, each in a plain and a bold line: to see how Discord really draws them */
export function paletteBlock(): string {
  const names: Record<AnsiColor, string> = { gray: 'gray', red: 'red', green: 'green', yellow: 'yellow', blue: 'blue', pink: 'pink', cyan: 'cyan', white: 'white' };
  return ANSI_COLORS.map((c) => `${seg(c, `${names[c]} normal`)}  ${seg(c, `${names[c]} bold`, true)}`).join(String.fromCharCode(10));
}

/** what an administrator wrote in Discord as it stands in the game chat: «[16:07] * [Discord] Имя: текст» (blue label, white text) */
export function ansiDiscordLine(name: string, text: string, time = ''): string {
  const t = forBlock(text);
  if (!t) return '';
  return `${seg('cyan', stamp(time))}${seg('blue', '* [Discord]', true)} ${seg('yellow', forBlock(name) || '?', true)}${seg('white', ': ')}${seg('white', t.slice(0, 300))}`;
}

/** the words of a kick split at {name} {reason} {admin}: the template, with what stands for each */
function kickParts(template: string): string[] {
  return forBlock(template).split(/(\{(?:name|reason|admin)\})/).filter(Boolean);
}

/** «[16:07] * Игрок Vamp был кикнут с сервера. Причина: спам» in an ansi block: red words, a green nickname, a yellow reason */
export function ansiKickLine(template: string, v: { name: string; reason: string; admin: string }, c: ChatColors, time = ''): string {
  const body = kickParts(template).map((p) => {
    if (p === '{name}') return seg(c.name, forBlock(v.name) || '?', true);
    if (p === '{reason}') return seg(c.tag, forBlock(v.reason), true);
    if (p === '{admin}') return seg('cyan', forBlock(v.admin) || '?', true);
    return seg(c.text, p);
  }).join('');
  return `${seg(c.text, stamp(time))}${body}`;
}

/** the same in the plain style: the nickname and the reason in bold */
export function formatKickLine(template: string, v: { name: string; reason: string; admin: string }, time = ''): string {
  const bold = (x: string) => `**${escapeDiscord(x.trim() || '?')}**`;
  const body = escapeDiscord(template).split(/(\{(?:name|reason|admin)\})/).filter(Boolean).map((p) => (p === '{name}' ? bold(v.name) : p === '{reason}' ? bold(v.reason) : p === '{admin}' ? bold(v.admin) : p)).join('');
  return `${stamp(time)}${body}`.trim();
}

/** a line of a chat in the colours of the game: «[16:07] [«Глобальный»] WhiteLegioN: Тест» (the time has the colour of the tag) */
export function ansiChatLine(kind: 'global' | 'clan' | 'local', name: string, clan: string, text: string, c: ChatColors, server = '', time = ''): string {
  const t = forBlock(text);
  if (!t || isCommand(t)) return '';
  const tag = kind === 'clan' && clan.trim() ? `${CHAT_LABEL.clan} ${forBlock(clan)}` : CHAT_LABEL[kind];
  const head = server ? seg('gray', `[${forBlock(server)}] `) : '';
  return `${seg(c.tag, stamp(time))}${head}${seg(c.tag, `[«${tag}»]`, true)} ${seg(c.name, forBlock(name) || '?', true)}${seg(c.text, ': ')}${seg(c.text, t.slice(0, 500))}`;
}

/** «[16:07] * Игрок WhiteLegioN подключился к серверу.» in two colours: the nickname and the rest */
export function ansiEventLine(template: string, name: string, c: ChatColors, server = '', time = ''): string {
  const head = server ? seg('gray', `[${forBlock(server)}] `) : '';
  const parts = forBlock(template).split('{name}');
  const nick = forBlock(name) || '?';
  const body = parts.map((p, i) => seg(c.text, p) + (i < parts.length - 1 ? seg(c.name, nick, true) : '')).join('');
  return `${seg(c.text, stamp(time))}${head}${body}`;
}

/** the text of a Discord message for some lines: an ansi block, or the lines as they are */
export function wrapForDiscord(style: ChatStyle, chunk: string): string {
  return style === 'ansi' ? `\`\`\`ansi\n${chunk}\n\`\`\`` : chunk;
}

/** lines joined into messages that fit Discord (2000 characters, a little less for the fences of a code block) */
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
