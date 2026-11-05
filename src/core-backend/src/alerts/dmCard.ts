/**
 * The look of the private messages of the bot: one embed card per kind (colour by meaning, fields, Discord timestamps,
 * buttons), the language of the person, the quiet hours and the grouping of alerts about one server. Pure: no database.
 */

export type Lang = 'ru' | 'en';

export interface CardButtonLink {
  label: string;
  url: string;
}
export interface CardButton {
  customId: string;
  label: string;
}
export interface DmCard {
  embed: {
    title: string;
    description?: string;
    color: number;
    fields?: { name: string; value: string; inline?: boolean }[];
    footer: { text: string; icon_url?: string };
    thumbnail?: { url: string };
    image?: { url: string };
    timestamp?: string;
  };
  /** link buttons */
  actions: CardButtonLink[];
  /** buttons the bot answers itself (`dmx:*`) */
  buttons: CardButton[];
  /** plain text for the delivery journal */
  summary: string;
}

export const COLORS = {
  good: 0x22c55e,
  bad: 0xef4444,
  info: 0x3b82f6,
  warn: 0xf59e0b,
  seen: 0x8b5cf6,
  news: 0x4f46e5,
  follow: 0x14b8a6,
  quiet: 0x64748b,
} as const;

export interface Ctx {
  lang: Lang;
  /** public address of the panel without a trailing slash; empty when unknown (no links then) */
  base: string;
  brand: string;
  logoUrl?: string;
}

const L = (lang: Lang, ru: string, en: string): string => (lang === 'en' ? en : ru);

/** Discord timestamp: shown in the time zone and language of the reader */
export const stamp = (ms: number, style: 'R' | 't' | 'f' | 'T' = 'R'): string => `<t:${Math.floor(ms / 1000)}:${style}>`;

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** the settings button under every card */
function settingsLink(c: Ctx): CardButtonLink[] {
  return c.base ? [{ label: L(c.lang, '⚙️ Настроить уведомления', '⚙️ Notification settings'), url: `${c.base}/profile` }] : [];
}

function make(c: Ctx, e: Omit<DmCard['embed'], 'footer'>, summary: string, o: { actions?: CardButtonLink[]; buttons?: CardButton[]; settings?: boolean } = {}): DmCard {
  const actions = [...(o.actions ?? []), ...(o.settings === false ? [] : settingsLink(c))].filter((a) => /^https?:\/\//i.test(a.url)).slice(0, 5);
  return {
    embed: { ...e, footer: { text: c.brand || 'CoreGSM', ...(c.logoUrl ? { icon_url: c.logoUrl } : {}) } },
    actions,
    buttons: (o.buttons ?? []).slice(0, 5),
    summary: clip(summary, 120),
  };
}

// ---------- server alerts (grouped) ----------
export type ServerEventKind = 'free_slot' | 'back_online' | 'went_down';
export interface ServerEvent {
  kind: ServerEventKind;
  ts: number;
  players: number;
  max: number;
}
export interface ServerData {
  serverId: number;
  name: string;
  address: string;
  events: ServerEvent[];
  /** picture with the graph of the server (empty when the panel is private) */
  imageUrl?: string;
  /** a test card */
  test?: boolean;
}

const EVENT_LINE: Record<ServerEventKind, [string, string]> = {
  free_slot: ['🟢 Освободилось место', '🟢 A slot is free'],
  back_online: ['✅ Снова в сети', '✅ Back online'],
  went_down: ['🔴 Недоступен', '🔴 Went down'],
};

export const eventLine = (lang: Lang, e: ServerEvent): string => {
  const [ru, en] = EVENT_LINE[e.kind];
  return `${L(lang, ru, en)} · ${stamp(e.ts)}`;
};

/** the colour of a group: the last event decides */
export const serverColor = (events: ServerEvent[]): number => {
  const last = events[events.length - 1]?.kind;
  return last === 'went_down' ? COLORS.bad : last === 'back_online' ? COLORS.good : COLORS.info;
};

export function serverCard(c: Ctx, d: ServerData): DmCard {
  const events = d.events.slice(-8);
  const last = events[events.length - 1] as ServerEvent | undefined;
  const title = d.test
    ? L(c.lang, '🧪 Проверка уведомлений', '🧪 Notification test')
    : events.length > 1
      ? L(c.lang, `📡 ${d.name}: ${events.length} события`, `📡 ${d.name}: ${events.length} events`)
      : last?.kind === 'went_down'
        ? L(c.lang, `🔴 ${d.name} недоступен`, `🔴 ${d.name} is down`)
        : last?.kind === 'free_slot'
          ? L(c.lang, `🟢 На ${d.name} освободилось место`, `🟢 A slot is free on ${d.name}`)
          : L(c.lang, `✅ ${d.name} снова в сети`, `✅ ${d.name} is back online`);
  const fields: NonNullable<DmCard['embed']['fields']> = [{ name: L(c.lang, 'Сервер', 'Server'), value: clip(d.name, 100), inline: true }];
  if (last && last.max > 0) fields.push({ name: L(c.lang, 'Игроков', 'Players'), value: `${last.players}/${last.max}`, inline: true });
  if (d.address) fields.push({ name: L(c.lang, 'Адрес', 'Address'), value: `\`${clip(d.address, 80)}\``, inline: true });
  const description = events.length > 1 ? events.map((e) => eventLine(c.lang, e)).join('\n') : last ? eventLine(c.lang, last) : '';
  return make(
    c,
    { title: clip(title, 250), description, color: serverColor(events), fields, ...(d.imageUrl ? { image: { url: d.imageUrl } } : {}), timestamp: new Date(last?.ts ?? 0).toISOString() },
    `${title}`,
    {
      actions: c.base ? [{ label: L(c.lang, '🔎 Открыть карточку', '🔎 Open the card'), url: `${c.base}/servers/${d.serverId}` }] : [],
      buttons: [{ customId: `dmx:mute:${d.serverId}`, label: L(c.lang, '🔕 Заглушить это', '🔕 Mute this') }],
    },
  );
}

// ---------- security ----------
export function newDeviceCard(c: Ctx, d: { device: string; ts: number }): DmCard {
  const device = clip(d.device.trim() || L(c.lang, 'неизвестное устройство', 'an unknown device'), 100);
  return make(
    c,
    {
      title: L(c.lang, '🔐 Новый вход в аккаунт', '🔐 New sign-in'),
      description: L(c.lang, 'Мы заметили вход с устройства, на котором вы раньше не были.', 'We noticed a sign-in from a device that was not used before.'),
      color: COLORS.warn,
      fields: [
        { name: L(c.lang, 'Устройство', 'Device'), value: device, inline: true },
        { name: L(c.lang, 'Время', 'Time'), value: `${stamp(d.ts, 'f')} (${stamp(d.ts)})`, inline: true },
        { name: L(c.lang, 'Что делать', 'What to do'), value: L(c.lang, 'Это вы? Нажмите «Это был я». Если нет, смените пароль и завершите другие сеансы.', 'Was it you? Press “It was me”. If not, change the password and end the other sessions.') },
      ],
    },
    L(c.lang, 'Новый вход в аккаунт', 'New sign-in'),
    {
      actions: c.base ? [{ label: L(c.lang, '🛡️ Безопасность', '🛡️ Security'), url: `${c.base}/profile` }] : [],
      buttons: [
        { customId: 'dmx:ack:me', label: L(c.lang, '✅ Это был я', '✅ It was me') },
        { customId: 'dmx:ack:notme', label: L(c.lang, '🚨 Это не я', '🚨 It was not me') },
      ],
      settings: false,
    },
  );
}

export function resetCard(c: Ctx, d: { username: string; url: string; expiresAt: number }): DmCard {
  return make(
    c,
    {
      title: L(c.lang, '🔑 Сброс пароля', '🔑 Password reset'),
      description: L(c.lang, 'Запрошен сброс пароля. Нажмите кнопку ниже, чтобы задать новый.', 'A password reset was requested. Press the button below to set a new one.'),
      color: COLORS.warn,
      fields: [
        { name: L(c.lang, 'Аккаунт', 'Account'), value: clip(d.username, 60), inline: true },
        { name: L(c.lang, 'Действует', 'Valid'), value: `${stamp(d.expiresAt)} · ${L(c.lang, 'один раз', 'once')}`, inline: true },
        { name: L(c.lang, 'Это были не вы?', 'Was it not you?'), value: L(c.lang, 'Просто проигнорируйте сообщение: пароль останется прежним.', 'Just ignore this message: the password stays as it is.') },
      ],
    },
    L(c.lang, 'Сброс пароля', 'Password reset'),
    { actions: [{ label: L(c.lang, '🔑 Задать новый пароль', '🔑 Set a new password'), url: d.url }], settings: false },
  );
}

export function changedCard(c: Ctx, d: { username: string; ts: number }): DmCard {
  return make(
    c,
    {
      title: L(c.lang, '✅ Пароль изменён', '✅ Password changed'),
      description: L(c.lang, 'Все сеансы завершены. Если это были не вы, срочно сообщите администратору.', 'All sessions were ended. If this was not you, contact an administrator.'),
      color: COLORS.good,
      fields: [
        { name: L(c.lang, 'Аккаунт', 'Account'), value: clip(d.username, 60), inline: true },
        { name: L(c.lang, 'Время', 'Time'), value: stamp(d.ts, 'f'), inline: true },
      ],
    },
    L(c.lang, 'Пароль изменён', 'Password changed'),
    { settings: false },
  );
}

// ---------- the rest ----------
export function seenCard(c: Ctx, d: { server: string; nick: string; ts: number; rank?: string }): DmCard {
  const fields: NonNullable<DmCard['embed']['fields']> = [
    { name: L(c.lang, 'Сервер', 'Server'), value: clip(d.server, 100), inline: true },
    { name: L(c.lang, 'Ник', 'Nick'), value: clip(d.nick, 60), inline: true },
  ];
  if (d.rank) fields.push({ name: L(c.lang, 'Ранг', 'Rank'), value: clip(d.rank, 60), inline: true });
  return make(
    c,
    {
      title: L(c.lang, '👣 Мы увидели вас на сервере', '👣 We saw you on the server'),
      description: L(c.lang, 'Статистика, ранг и достижения теперь считаются.', 'Statistics, rank and achievements are now counted.'),
      color: COLORS.seen,
      fields,
      timestamp: new Date(d.ts).toISOString(),
    },
    L(c.lang, `Мы увидели вас на сервере «${d.server}»`, `We saw you on “${d.server}”`),
    { actions: c.base ? [{ label: L(c.lang, '👤 Открыть профиль', '👤 Open the profile'), url: `${c.base}/profile` }] : [] },
  );
}

export function newsCard(c: Ctx, d: { title: string; category: string; text?: string; imageUrl?: string; url: string; ts: number }): DmCard {
  const text = (d.text ?? '').replace(/\s+/g, ' ').trim();
  return make(
    c,
    {
      title: clip(`📰 ${d.title}`, 250),
      ...(text ? { description: clip(text, 280) } : {}),
      color: COLORS.news,
      fields: d.category ? [{ name: L(c.lang, 'Рубрика', 'Category'), value: clip(d.category, 60), inline: true }] : [],
      ...(d.imageUrl ? { image: { url: d.imageUrl } } : {}),
      timestamp: new Date(d.ts).toISOString(),
    },
    clip(d.title, 100),
    { actions: d.url ? [{ label: L(c.lang, '📖 Читать на сайте', '📖 Read on the site'), url: d.url }] : [] },
  );
}

export function followCard(c: Ctx, d: { nick: string; server: string; address: string; serverId: number; ts: number }): DmCard {
  const fields: NonNullable<DmCard['embed']['fields']> = [
    { name: L(c.lang, 'Игрок', 'Player'), value: clip(d.nick, 60), inline: true },
    { name: L(c.lang, 'Сервер', 'Server'), value: clip(d.server, 100), inline: true },
  ];
  if (d.address) fields.push({ name: L(c.lang, 'Адрес', 'Address'), value: `\`${clip(d.address, 80)}\``, inline: true });
  return make(
    c,
    {
      title: L(c.lang, `🟢 ${d.nick} в сети`, `🟢 ${d.nick} is online`),
      description: L(c.lang, `Игрок зашёл на сервер ${stamp(d.ts)}.`, `The player joined the server ${stamp(d.ts)}.`),
      color: COLORS.follow,
      fields,
      timestamp: new Date(d.ts).toISOString(),
    },
    L(c.lang, `${d.nick} в сети`, `${d.nick} is online`),
    {
      actions: c.base ? [{ label: L(c.lang, '🔎 Открыть карточку', '🔎 Open the card'), url: `${c.base}/servers/${d.serverId}` }] : [],
      buttons: [{ customId: `dmx:mute:${d.serverId}`, label: L(c.lang, '🔕 Заглушить сервер', '🔕 Mute the server') }],
    },
  );
}

/** the morning card: what arrived during the quiet hours */
export function digestCard(c: Ctx, d: { lines: string[]; since: number }): DmCard {
  const shown = d.lines.slice(-15);
  const more = d.lines.length - shown.length;
  return make(
    c,
    {
      title: L(c.lang, '🌅 Пока вы отдыхали', '🌅 While you were away'),
      description: clip(shown.join('\n') + (more > 0 ? `\n${L(c.lang, `…и ещё ${more}`, `…and ${more} more`)}` : ''), 3800),
      color: COLORS.quiet,
      fields: [{ name: L(c.lang, 'Событий', 'Events'), value: String(d.lines.length), inline: true }, { name: L(c.lang, 'С', 'Since'), value: stamp(d.since, 'f'), inline: true }],
    },
    L(c.lang, `Пока вы отдыхали: ${d.lines.length}`, `While you were away: ${d.lines.length}`),
  );
}

/** the one line of a card in the morning digest */
export function digestLine(title: string, ts: number): string {
  return `• ${clip(title.replace(/\s+/g, ' ').trim(), 150)} · ${stamp(ts)}`;
}

// ---------- weekly summary for administrators ----------
export interface WeeklyStats {
  from: number;
  to: number;
  /** most players online at once, this week and the week before */
  peak: number;
  peakPrev: number;
  peakAt: number | null;
  newPlayers: number;
  activePlayers: number;
  newAccounts: number;
  warns: number;
  bans: number;
  kicks: number;
  mutes: number;
  reports: number;
}

/** «▲ 12%» / «▼ 5%» / «=»: the change against the week before */
export function trend(now: number, prev: number): string {
  if (prev <= 0) return now > 0 ? '▲ new' : '=';
  const p = Math.round(((now - prev) / prev) * 100);
  return p === 0 ? '=' : `${p > 0 ? '▲' : '▼'} ${Math.abs(p)}%`;
}

export function weeklyCard(c: Ctx, w: WeeklyStats): DmCard {
  const punish = w.warns + w.bans + w.kicks + w.mutes;
  return make(
    c,
    {
      title: L(c.lang, '📈 Итоги недели', '📈 Weekly summary'),
      description: L(c.lang, `Период: ${stamp(w.from, 'f')} — ${stamp(w.to, 'f')}`, `Period: ${stamp(w.from, 'f')} — ${stamp(w.to, 'f')}`),
      color: COLORS.news,
      fields: [
        { name: L(c.lang, '🔝 Пик онлайна', '🔝 Peak online'), value: `**${w.peak}** · ${trend(w.peak, w.peakPrev)}${w.peakAt ? `\n${stamp(w.peakAt, 'f')}` : ''}`, inline: true },
        { name: L(c.lang, '🆕 Новых игроков', '🆕 New players'), value: String(w.newPlayers), inline: true },
        { name: L(c.lang, '🎮 Играло', '🎮 Played'), value: String(w.activePlayers), inline: true },
        { name: L(c.lang, '👤 Новых аккаунтов', '👤 New accounts'), value: String(w.newAccounts), inline: true },
        { name: L(c.lang, '🛡️ Наказаний', '🛡️ Punishments'), value: `${punish}\n⚠️ ${w.warns} · 🔨 ${w.bans} · 👢 ${w.kicks} · 🔇 ${w.mutes}`, inline: true },
        { name: L(c.lang, '🚩 Жалоб', '🚩 Reports'), value: String(w.reports), inline: true },
      ],
      timestamp: new Date(w.to).toISOString(),
    },
    L(c.lang, 'Итоги недели', 'Weekly summary'),
    { actions: c.base ? [{ label: L(c.lang, '📊 Открыть панель', '📊 Open the panel'), url: c.base }] : [] },
  );
}

/** weekday (0 = Sunday) and hour of a moment in a time zone */
export function weekdayHour(ms: number, tz: string): { day: number; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', hourCycle: 'h23', ...(tz ? { timeZone: tz } : {}) }).formatToParts(new Date(ms));
    const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd), hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24 };
  } catch {
    const d = new Date(ms);
    return { day: d.getUTCDay(), hour: d.getUTCHours() };
  }
}

/** the summary goes out on Monday from 09:00 (server time), once per week */
export function weeklyDue(now: number, lastAt: number, tz: string): boolean {
  const { day, hour } = weekdayHour(now, tz);
  return day === 1 && hour >= 9 && now - lastAt >= 6 * 86_400_000;
}

// ---------- quiet hours ----------
export interface Quiet {
  /** hour of the day 0-23 when the quiet time starts; -1 = off */
  from: number;
  /** hour of the day 0-23 when it ends */
  to: number;
}
export const QUIET_OFF: Quiet = { from: -1, to: -1 };

export const normQuiet = (v: unknown): Quiet => {
  const o = (v ?? {}) as Partial<Quiet>;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 23;
  return ok(o.from) && ok(o.to) && o.from !== o.to ? { from: o.from, to: o.to } : QUIET_OFF;
};

/** the hour (0-23) in the time zone; the zone of the server when it is empty or unknown */
export function localHour(ms: number, tz: string): number {
  try {
    const h = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', ...(tz ? { timeZone: tz } : {}) }).formatToParts(new Date(ms)).find((p) => p.type === 'hour')?.value;
    return h === undefined ? new Date(ms).getUTCHours() : Number(h) % 24;
  } catch {
    return new Date(ms).getUTCHours();
  }
}

export function inQuiet(hour: number, q: Quiet): boolean {
  if (q.from < 0 || q.to < 0 || q.from === q.to) return false;
  return q.from < q.to ? hour >= q.from && hour < q.to : hour >= q.from || hour < q.to;
}

/** when the quiet time ends (ms, rounded to the quarter of an hour); `now` itself when it is not quiet */
export function quietEnd(now: number, q: Quiet, tz: string): number {
  if (!inQuiet(localHour(now, tz), q)) return now;
  const step = 15 * 60_000;
  let t = now - (now % step) + step;
  for (let i = 0; i < 96 + 4 && inQuiet(localHour(t, tz), q); i++) t += step;
  return t;
}

/** security notices and password letters are never held back */
export const BYPASS_QUIET: ReadonlySet<string> = new Set(['newdevice', 'reset', 'changed', 'test', 'weekly']);

/** how long a new alert about a server waits for its neighbours before it is sent */
export const GROUP_WAIT_MS = 20_000;
