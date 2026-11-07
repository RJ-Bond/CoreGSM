/**
 * Game news: the editor text, the colours and the preview of how it looks in the in-game chat.
 * The same tag rules as the backend (core-backend/src/gamenews/gameNewsLogic.ts): only <color=#RRGGBB>, <b>, <i>.
 */

export const MAX_VISIBLE = 400;
/** the game chat takes 512 bytes; Cyrillic letters are 2 bytes each, tags count too */
export const MAX_BYTES = 500;
export const byteLength = (s: string): number => new TextEncoder().encode(s).length;

export interface NewsServerInfo { id: number; name: string; address: string; game: string; supported: boolean; hasToken: boolean; lastSeen: number | null; online: boolean; pluginVersion: string; players: number | null; maxPlayers: number | null }
export type NewsStatus = 'queued' | 'delivered' | 'expired' | 'failed';
export interface NewsLogRow { id: number; serverId: number | null; serverName: string; text: string; status: NewsStatus; error: string; sentBy: string; sentAt: number; deliveredAt: number | null }
export interface NewsSendResult { text: string; results: { serverId: number; serverName: string; queued: boolean; online: boolean; error: string }[] }

/** the lines to paste into BepInEx/config/CoreGSM.cfg of the game server */
export function pluginConfig(panelUrl: string, token: string): string {
  const selfSigned = /^https:\/\/(\d{1,3}\.){3}\d{1,3}(:|\/|$)/.test(panelUrl);
  return ['[Panel]', `Url = ${panelUrl}`, `Token = ${token}`, `AllowSelfSigned = ${selfSigned}`].join('\n');
}

export interface Swatch { id: string; hex: string }

/** the colours of the toolbar; `id` picks the caption in the locale (gn.c.<id>) */
export const SWATCHES: Swatch[] = [
  { id: 'info', hex: '#6EC1FF' },
  { id: 'good', hex: '#5FD068' },
  { id: 'warn', hex: '#FFCC33' },
  { id: 'danger', hex: '#FF5555' },
  { id: 'event', hex: '#B86BFF' },
  { id: 'gold', hex: '#FFB347' },
  { id: 'white', hex: '#FFFFFF' },
];

export const TEMPLATES: { id: string; text: (time: string) => string }[] = [
  { id: 'restart', text: (tm) => `<color=#FFCC33>Перезапуск сервера через ${tm}.</color> Сохраните прогресс и возвращайтесь через пару минут.` },
  { id: 'wipe', text: (tm) => `<color=#FF5555><b>Вайп</b></color> ${tm}. Подробности на сайте.` },
  { id: 'event', text: (tm) => `<color=#B86BFF><b>Событие</b></color> стартует ${tm}! Заходите на сервер.` },
  { id: 'maintenance', text: (tm) => `<color=#6EC1FF>Технические работы</color> ${tm}. Сервер может быть недоступен.` },
];

export type Seg = { text: string; color: string | null; bold: boolean; italic: boolean };

const TAG = /<(\/?)(color|b|i)(?:=(#[0-9a-fA-F]{6}))?>/gi;

/** the text with the tags cut out */
export function visibleText(raw: string): string {
  return raw.replace(/<[^>]*>/g, '');
}

/** splits the text into styled pieces for the preview (unknown tags are shown as plain text without the angle brackets) */
export function parseNews(raw: string): Seg[] {
  const segs: Seg[] = [];
  const colors: string[] = [];
  let bold = 0;
  let italic = 0;
  let last = 0;
  const push = (t: string) => {
    // a tag the game would not draw is removed whole, like the backend does
    const text = t.replace(/<[^<>]*>/g, '').replace(/[<>]/g, '');
    if (text) segs.push({ text, color: colors.length ? colors[colors.length - 1] : null, bold: bold > 0, italic: italic > 0 });
  };
  for (const m of raw.matchAll(TAG)) {
    push(raw.slice(last, m.index));
    last = m.index + m[0].length;
    const close = m[1] === '/';
    const name = m[2].toLowerCase();
    if (name === 'color') { if (close) colors.pop(); else if (m[3]) colors.push(m[3].toUpperCase()); }
    else if (name === 'b') bold = Math.max(0, bold + (close ? -1 : 1));
    else italic = Math.max(0, italic + (close ? -1 : 1));
  }
  push(raw.slice(last));
  return segs;
}

/** wraps text[start, end) into a tag; returns the new text and where the selection should be */
export function wrapSelection(text: string, start: number, end: number, open: string, close: string): { text: string; start: number; end: number } {
  const a = Math.max(0, Math.min(start, end));
  const b = Math.max(a, Math.max(start, end));
  const sel = text.slice(a, b) || '…';
  const out = text.slice(0, a) + open + sel + close + text.slice(b);
  return { text: out, start: a + open.length, end: a + open.length + sel.length };
}

export const colorOpen = (hex: string): string => `<color=${hex.toUpperCase()}>`;
export const isHex = (s: string): boolean => /^#[0-9a-fA-F]{6}$/.test(s);

/** whether the author left a tag open (the backend closes it, the editor only warns) */
export function unbalanced(raw: string): boolean {
  const depth: Record<string, number> = { color: 0, b: 0, i: 0 };
  for (const m of raw.matchAll(TAG)) {
    const n = m[2].toLowerCase();
    depth[n] += m[1] === '/' ? -1 : 1;
    if (depth[n] < 0) return true;
  }
  return depth.color !== 0 || depth.b !== 0 || depth.i !== 0;
}

export function validateNews(raw: string): string | null {
  const v = visibleText(raw).trim();
  if (!v) return 'empty';
  if (v.length > MAX_VISIBLE || byteLength(raw) > MAX_BYTES) return 'long';
  return null;
}

export type RuleKind = 'interval' | 'daily' | 'once';

/** an automatic announcement as the panel returns it */
export interface RuleInfo {
  id: number;
  name: string;
  text: string;
  /** [] = every server that has a plugin */
  serverIds: number[];
  kind: RuleKind;
  everyMin: number;
  times: string[];
  runAt: number | null;
  activeFrom: number | null;
  activeTo: number | null;
  onlyOnline: boolean;
  enabled: boolean;
  lastRun: number | null;
  nextRun: number | null;
  createdBy: string;
  /** the next runs (up to 5) of an enabled rule */
  upcoming: number[];
}

export type RuleBody = Omit<RuleInfo, 'id' | 'lastRun' | 'nextRun' | 'createdBy' | 'upcoming'>;

export const INTERVAL_PRESETS = [15, 30, 60, 120, 360];
export const MIN_EVERY = 5;
export const MAX_EVERY = 10_080;

export const isHHMM = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export const emptyRule = (): RuleBody => ({
  name: '', text: '', serverIds: [], kind: 'interval', everyMin: 60, times: ['20:00'], runAt: null,
  activeFrom: null, activeTo: null, onlyOnline: true, enabled: true,
});

/** what is wrong with a rule (a key part of the message), or null */
export function validateRule(r: RuleBody, now: number): 'name' | 'text' | 'every' | 'times' | 'runAt' | 'period' | null {
  if (!r.name.trim()) return 'name';
  if (validateNews(r.text)) return 'text';
  if (r.kind === 'interval' && (!Number.isInteger(r.everyMin) || r.everyMin < MIN_EVERY || r.everyMin > MAX_EVERY)) return 'every';
  if (r.kind === 'daily' && (!r.times.length || !r.times.every(isHHMM))) return 'times';
  if (r.kind === 'once' && (r.runAt == null || r.runAt <= now)) return 'runAt';
  if (r.activeFrom != null && r.activeTo != null && r.activeTo < r.activeFrom) return 'period';
  return null;
}

/** true when version `a` is older than `b` (numeric dotted versions: 0.2.0 < 0.10.1); an unknown version counts as older */
export function versionLess(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => parseInt(x, 10));
  const pb = b.split('.').map((x) => parseInt(x, 10));
  if (!a || pa.some(Number.isNaN)) return true;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** the variables the panel fills in for each server when it sends */
export const VARIABLES = ['server', 'online', 'max', 'time', 'greeting', 'restart', 'wipe', 'discord', 'tip'] as const;
export type VarName = (typeof VARIABLES)[number];
const SAMPLE: Record<VarName, string> = {
  server: 'Мой сервер', online: '12', max: '40', time: '20:00', greeting: 'Добрый вечер', restart: '3 ч 20 мин',
  wipe: '12.11, 20:00', discord: 'discord.gg/coregsm', tip: 'Сохраняйтесь у сундука.',
};

/** the variables of the greeting: {name} is the nickname of the joining player (the plugin fills it in) */
export const WELCOME_VARIABLES = ['name', ...VARIABLES] as const;

/** the colour of a player's name in the greeting (the same as the backend uses) */
export const NAME_COLOR = '#5FD068';

/** {name} outside any colour tag becomes green (a name the administrator coloured by hand is left alone) */
export function greenName(text: string): string {
  let depth = 0;
  return text
    .split(/(<\/?color(?:=#[0-9a-fA-F]{6})?>)/i)
    .map((part) => {
      if (/^<color=/i.test(part)) { depth++; return part; }
      if (/^<\/color>/i.test(part)) { depth = Math.max(0, depth - 1); return part; }
      return depth === 0 ? part.replace(/\{name\}/g, `<color=${NAME_COLOR}>{name}</color>`) : part;
    })
    .join('');
}

/** the preview shows sample values for the variables ({name} only in a greeting, in green as in the game) */
export function fillSample(text: string, welcome = false): string {
  const s = text.replace(/\{(server|online|max|time|greeting|restart|wipe|discord|tip)\}/g, (_m, k: VarName) => SAMPLE[k]);
  return welcome ? greenName(s).replace(/\{name\}/g, 'Игрок') : s;
}

/** «* Игрок {name} подключился к серверу.» for everybody when a player joins or leaves */
export interface JoinLeave {
  joinEnabled: boolean;
  leaveEnabled: boolean;
  joinText: string;
  leaveText: string;
  nameColor: string;
  textColor: string;
}

/** the line with {name} in the name colour and the rest in the text colour (the same as the backend builds it) */
export function composeLine(text: string, nameColor: string, textColor: string): string {
  // control characters become spaces (the chat is one line); angle brackets would be taken for tags
  const noCtl = Array.from(text, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('');
  const plain = noCtl.replace(/[<>]/g, '').replace(/ {2,}/g, ' ').trim();
  return `<color=${textColor.toUpperCase()}>${plain.replace(/\{name\}/g, `<color=${nameColor.toUpperCase()}>{name}</color>`)}</color>`;
}

/** the greeting: one text for everybody, or one for a newcomer and one for a returning player */
export interface Welcome { enabled: boolean; text: string; split: boolean; newText: string }

/** what {discord} and {tip} stand for */
export interface Extras { discord: string; tips: string[] }

/** ready greetings: a click puts the texts into the editors (the administrator edits them after) */
export interface WelcomeStyle { id: string; text: string; newText: string }
export const WELCOME_STYLES: WelcomeStyle[] = [
  {
    id: 'classic',
    text: '<color=#5FD068><b>{greeting}, {name}!</b></color> Добро пожаловать на <color=#FFCC33>{server}</color>. Сейчас на сервере {online} из {max} игроков.',
    newText: '<color=#5FD068><b>Добро пожаловать, {name}!</b></color> Это <color=#FFCC33>{server}</color>. Загляните в наш Discord: <color=#6EC1FF>{discord}</color>',
  },
  {
    id: 'gothic',
    text: '<color=#FF5555><b>{name}</b></color><color=#FFB347>, ночь принадлежит вам. На {server} сейчас {online} из {max}.</color>',
    newText: '<color=#FF5555><b>Тьма приветствует тебя, {name}.</b></color> <color=#FFB347>{server} ждёт.</color> До рестарта: {restart}.',
  },
  {
    id: 'minimal',
    text: '{greeting}, {name}. Онлайн: {online}/{max}.',
    newText: 'Добро пожаловать на {server}, {name}. Discord: {discord}',
  },
  {
    id: 'festive',
    text: '<color=#B86BFF><b>{greeting}, {name}!</b></color> <color=#FFB347>Рады видеть вас на {server}!</color> <color=#6EC1FF>Совет: {tip}</color>',
    newText: '<color=#B86BFF><b>Добро пожаловать, {name}!</b></color> <color=#FFB347>Приятной игры на {server}!</color> <color=#6EC1FF>Совет: {tip}</color>',
  },
];

/** registration in the panel from the game: switch, texts and how often the Discord hint is repeated */
export interface RegisterSettings {
  enabled: boolean;
  promptText: string;
  doneText: string;
  discordText: string;
  pendingText: string;
  discordEveryHours: number;
}

/** the game chat in Discord: one webhook (its address never leaves the backend), a switch for each kind of line and how they look */
export const CHAT_KINDS = ['global', 'clan', 'local', 'join', 'leave'] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];
/** the eight colours of an ansi block of Discord */
/** ready looks of the chat in Discord: the colours of the game, calm, bright, or no colours at all */
export const CHAT_PRESETS: { id: 'game' | 'calm' | 'bright' | 'plain'; style: 'ansi' | 'plain'; colors: Record<ChatKind, ChatColors> }[] = [
  {
    id: 'game', style: 'ansi',
    colors: {
      global: { tag: 'blue', name: 'yellow', text: 'blue' }, local: { tag: 'blue', name: 'yellow', text: 'blue' }, clan: { tag: 'green', name: 'yellow', text: 'green' },
      join: { tag: 'green', name: 'pink', text: 'green' }, leave: { tag: 'green', name: 'pink', text: 'green' },
    },
  },
  {
    id: 'calm', style: 'ansi',
    colors: {
      global: { tag: 'gray', name: 'white', text: 'gray' }, local: { tag: 'gray', name: 'white', text: 'gray' }, clan: { tag: 'gray', name: 'white', text: 'gray' },
      join: { tag: 'gray', name: 'white', text: 'gray' }, leave: { tag: 'gray', name: 'white', text: 'gray' },
    },
  },
  {
    id: 'bright', style: 'ansi',
    colors: {
      global: { tag: 'cyan', name: 'yellow', text: 'white' }, local: { tag: 'gray', name: 'yellow', text: 'gray' }, clan: { tag: 'green', name: 'yellow', text: 'white' },
      join: { tag: 'green', name: 'pink', text: 'green' }, leave: { tag: 'red', name: 'pink', text: 'red' },
    },
  },
  {
    id: 'plain', style: 'plain',
    colors: {
      global: { tag: 'white', name: 'white', text: 'white' }, local: { tag: 'white', name: 'white', text: 'white' }, clan: { tag: 'white', name: 'white', text: 'white' },
      join: { tag: 'white', name: 'white', text: 'white' }, leave: { tag: 'white', name: 'white', text: 'white' },
    },
  },
];

export const ANSI_COLORS = ['gray', 'red', 'green', 'yellow', 'blue', 'pink', 'cyan', 'white'] as const;
export type AnsiColor = (typeof ANSI_COLORS)[number];
export interface ChatColors { tag: AnsiColor; name: AnsiColor; text: AnsiColor }
export interface ChatSettings {
  enabled: boolean;
  set: boolean;
  tail: string;
  kinds: Record<ChatKind, boolean>;
  style: 'ansi' | 'plain';
  senderName: string;
  /** «[16:07]» in front of every line, like in the game */
  showTime: boolean;
  colors: Record<ChatKind, ChatColors>;
  /** an administrator's message in the channel goes to the game */
  fromDiscord: boolean;
  /** the channel of the webhook is known (the bot can listen to it) */
  channel: boolean;
}

/** everything the «rules» endpoint returns: automatic announcements and the settings of the events */
export interface RulesState {
  timezone: string;
  restartCountdown: boolean;
  welcome: Welcome;
  joinLeave: JoinLeave;
  extras: Extras;
  register: RegisterSettings;
  chat: ChatSettings;
  /** the servers that have settings of their own, by key */
  overrides: Record<string, number[]>;
  /** for one server: which parts have their own value */
  mine: Record<string, boolean> | null;
  rules: RuleInfo[];
}
