/** /help: the texts (Russian and English), the sections, the details of every command and small helpers. No discord.js import. */

export type Lang = 'ru' | 'en';
/** the language of the person from their Discord locale («ru», «en-US», «en-GB», …): Russian for Russian, English for the rest */
export const langOf = (locale: string | null | undefined): Lang => (/^ru/i.test(locale ?? '') || !locale ? 'ru' : 'en');

interface Two { ru: string; en: string }
export interface CmdInfo {
  cmd: string;
  text: Two;
  usage: string;
  examples: string[];
  needs: Two;
}

const NONE: Two = { ru: 'ничего особенного', en: 'nothing special' };
const ADMIN: Two = { ru: 'право «Администратор» у вас', en: 'the Administrator permission for you' };
const withBot = (ru: string, en: string): Two => ({ ru: `право «Администратор» у вас; у бота: ${ru}`, en: `the Administrator permission for you; for the bot: ${en}` });

export const CMDS: CmdInfo[] = [
  { cmd: '/register', text: { ru: 'создать аккаунт в панели через Discord, пароль не нужен', en: 'create an account in the panel through Discord, no password' }, usage: '/register nick:<ник> [agree:True]', examples: ['/register nick:Vasya'], needs: NONE },
  { cmd: '/faq', text: { ru: 'ответ на частый вопрос: начните вводить и выберите из списка', en: 'answer to a frequent question: start typing and pick from the list' }, usage: '/faq question:<вопрос>', examples: ['/faq question:Как зайти на сервер'], needs: NONE },
  { cmd: '/link', text: { ru: 'привязать игровой ник: выберите себя из списка или впишите вручную', en: 'link your in-game nick: pick yourself from the list or type it' }, usage: '/link', examples: ['/link'], needs: NONE },
  { cmd: '/nick', text: { ru: 'сменить игровой ник, по которому считается статистика', en: 'change the in-game nick your statistics are counted by' }, usage: '/nick nick:<ник>', examples: ['/nick nick:Vasya'], needs: NONE },
  { cmd: '/profile', text: { ru: 'моя карточка: ранг, часы в игре, достижения', en: 'my card: rank, hours played, achievements' }, usage: '/profile', examples: ['/profile'], needs: NONE },
  { cmd: '/roles', text: { ru: 'выбрать себе роли в меню: взять или снять', en: 'pick your roles in a menu: take or remove' }, usage: '/roles', examples: ['/roles'], needs: NONE },
  { cmd: '/online', text: { ru: 'сколько игроков на каждом сервере', en: 'how many players are on every server' }, usage: '/online', examples: ['/online'], needs: NONE },
  { cmd: '/servers', text: { ru: 'список серверов с кнопками: нажмите, чтобы открыть карточку', en: 'a list of servers with buttons: press one to open its card' }, usage: '/servers', examples: ['/servers'], needs: NONE },
  { cmd: '/status', text: { ru: 'карточка сервера с графиком за сутки', en: 'a server card with the graph of the day' }, usage: '/status server:<сервер>', examples: ['/status server:Just-Skill'], needs: NONE },
  { cmd: '/player', text: { ru: 'карточка игрока: часы, серия дней, где и когда играет', en: 'a player card: hours, streak, where and when they play' }, usage: '/player nick:<ник>', examples: ['/player nick:Vasya'], needs: NONE },
  { cmd: '/top', text: { ru: 'самые активные игроки за неделю или месяц', en: 'the most active players of the week or the month' }, usage: '/top [period:неделя|месяц]', examples: ['/top', '/top period:месяц'], needs: NONE },
  { cmd: '/giveaway', text: { ru: 'розыгрыш призов: кнопка «Участвую», условия (роль, часы игры), честный выбор победителей', en: 'prize giveaway: a «Join» button, conditions (role, hours of play), a fair draw' }, usage: '/giveaway start prize:<приз> hours:<часы> [winners] [role] [min_hours] · end id · reroll id', examples: ['/giveaway start prize:Скин hours:24 winners:2 min_hours:10', '/giveaway end id:3'], needs: NONE },
  { cmd: '/clear', text: { ru: 'очистить чат в этом канале: с подтверждением, закреплённые остаются', en: 'wipe the chat of this channel: with a confirmation, pinned messages stay' }, usage: '/clear [count:<число>] [user:@участник]', examples: ['/clear', '/clear count:50', '/clear user:@Vasya'], needs: withBot('«Управлять сообщениями» и «Читать историю»', 'Manage Messages and Read Message History') },
  { cmd: '/ban', text: { ru: 'заблокировать участника с причиной (удаляет его сообщения, пишет ему в ЛС)', en: 'ban a member with a reason (deletes their messages, writes to them privately)' }, usage: '/ban user:@участник reason:<причина> [delete_days:0|1|7]', examples: ['/ban user:@Vasya reason:спам'], needs: withBot('«Банить участников»', 'Ban Members') },
  { cmd: '/unban', text: { ru: 'снять блокировку: без параметра покажет список банов с меню, с параметром подскажет имя или ID', en: 'lift a ban: without a parameter shows the ban list with a menu, with one suggests a name or ID' }, usage: '/unban [user:<имя или ID>]', examples: ['/unban', '/unban user:Vasya'], needs: withBot('«Банить участников»', 'Ban Members') },
  { cmd: '/kick', text: { ru: 'исключить участника с причиной, он сможет вернуться по приглашению', en: 'kick a member with a reason, they can return by an invite' }, usage: '/kick user:@участник reason:<причина>', examples: ['/kick user:@Vasya reason:реклама'], needs: withBot('«Выгонять участников»', 'Kick Members') },
  { cmd: '/warn', text: { ru: 'вынести предупреждение: шкала ●●○○○, прошлые причины, лесенка наказаний из панели', en: 'give a warning: a ●●○○○ scale, earlier reasons, the ladder of punishments from the panel' }, usage: '/warn user:@участник reason:<причина>', examples: ['/warn user:@Vasya reason:мат в чате'], needs: ADMIN },
  { cmd: '/mute', text: { ru: 'запретить писать и говорить на время (10m, 1h, 1d… до 28 дней)', en: 'forbid writing and speaking for a while (10m, 1h, 1d… up to 28 days)' }, usage: '/mute user:@участник duration:<срок> reason:<причина>', examples: ['/mute user:@Vasya duration:1h reason:флуд'], needs: withBot('«Отправлять участников подумать о своём поведении»', 'Timeout Members') },
  { cmd: '/unmute', text: { ru: 'снять мут досрочно', en: 'lift a mute early' }, usage: '/unmute user:@участник', examples: ['/unmute user:@Vasya'], needs: ADMIN },
];

export interface Category {
  id: string;
  emoji: string;
  color: number;
  /** only for administrators of the Discord server */
  admin?: boolean;
  label: Two;
  title: Two;
  /** the commands of the section (names with a slash) and extra lines that are not slash commands */
  cmds: string[];
  extra?: { cmd: string; text: Two }[];
}

export const CATEGORIES: Category[] = [
  { id: 'play', emoji: '🙋', color: 0x57f287, label: { ru: 'Игроку', en: 'Player' }, title: { ru: 'Игроку: аккаунт и профиль', en: 'Player: account and profile' }, cmds: ['/register', '/link', '/nick', '/profile', '/roles', '/faq'] },
  { id: 'srv', emoji: '🖥️', color: 0x3b82f6, label: { ru: 'Серверы', en: 'Servers' }, title: { ru: 'Серверы: кто и где играет', en: 'Servers: who plays where' }, cmds: ['/online', '/servers', '/status'] },
  { id: 'stat', emoji: '📊', color: 0x8b5cf6, label: { ru: 'Статистика', en: 'Statistics' }, title: { ru: 'Статистика игроков', en: 'Player statistics' }, cmds: ['/player', '/top'] },
  {
    id: 'mod', emoji: '🛡️', color: 0xef4444, admin: true, label: { ru: 'Модерация', en: 'Moderation' }, title: { ru: 'Модерация (для администраторов)', en: 'Moderation (for administrators)' },
    cmds: ['/clear', '/giveaway', '/ban', '/unban', '/kick', '/warn', '/mute', '/unmute'],
    extra: [{ cmd: '⚠️ Предупредить', text: { ru: 'правый клик по участнику или сообщению → «Приложения»: окно с причиной, к варну прикрепляется ссылка на сообщение', en: 'right-click a member or a message → «Apps»: a window with the reason, the message link is attached to the warning' } }],
  },
  { id: 'modclr', emoji: '🧹', color: 0xef4444, admin: true, label: { ru: 'Памятка /clear', en: '/clear guide' }, title: { ru: 'Команда /clear: как это работает', en: 'The /clear command: how it works' }, cmds: [] },
  { id: 'news', emoji: '🆕', color: 0x4f46e5, label: { ru: 'Что нового', en: "What's new" }, title: { ru: 'Что нового', en: "What's new" }, cmds: [] },
];

/** one short line per section for the first screen */
export const BLURB: Record<string, Two> = {
  play: { ru: 'аккаунт, ник, профиль, роли', en: 'account, nick, profile, roles' },
  srv: { ru: 'кто и где играет сейчас', en: 'who plays where right now' },
  stat: { ru: 'карточки игроков и топ', en: 'player cards and the top' },
  mod: { ru: 'бан, кик, мут, предупреждения, очистка', en: 'ban, kick, mute, warnings, cleaning' },
  modclr: { ru: 'примеры и что удаляется', en: 'examples and what gets deleted' },
  news: { ru: 'последние изменения бота и панели', en: 'the latest changes of the bot and the panel' },
};

export const cmdInfo = (cmd: string): CmdInfo | undefined => CMDS.find((c) => c.cmd === cmd || c.cmd === `/${cmd.replace(/^\//, '')}`);
export const categoryOf = (cmd: string): Category | undefined => CATEGORIES.find((c) => c.cmds.includes(cmd));
export const visibleCategories = (admin: boolean): Category[] => CATEGORIES.filter((c) => admin || !c.admin);

/** the commands the person may ask about, filtered by what they typed (for the autocomplete of `/help command:`) */
export function suggestCommands(query: string, admin: boolean, lang: Lang): { name: string; value: string }[] {
  const q = query.trim().toLowerCase().replace(/^\//, '');
  const allowed = new Set(visibleCategories(admin).flatMap((c) => c.cmds));
  return CMDS.filter((c) => allowed.has(c.cmd) && (!q || c.cmd.slice(1).includes(q) || c.text[lang].toLowerCase().includes(q)))
    .slice(0, 25)
    .map((c) => ({ name: `${c.cmd} — ${c.text[lang]}`.slice(0, 100), value: c.cmd.slice(1) }));
}

export const UI = {
  title: { ru: '📖 Что умеет бот', en: '📖 What the bot can do' },
  intro: { ru: 'Выберите раздел в меню ниже: в каждом команды с коротким пояснением. Подробности по одной команде: `/help command:ban`.', en: 'Pick a section in the menu below: each has commands with a short note. Details of one command: `/help command:ban`.' },
  placeholder: { ru: 'Выберите раздел…', en: 'Pick a section…' },
  home: { ru: 'Главная', en: 'Home' },
  homeDesc: { ru: 'Что умеет бот', en: 'What the bot can do' },
  panel: { ru: 'Панель', en: 'Panel' },
  support: { ru: 'Поддержка', en: 'Support' },
  close: { ru: 'Закрыть', en: 'Close' },
  online: { ru: 'Онлайн сейчас', en: 'Online now' },
  top: { ru: 'Топ недели', en: 'Top of the week' },
  closed: { ru: '✖️ Закрыто', en: '✖️ Closed' },
  stale: { ru: 'Это меню устарело. Вызовите `/help` заново.', en: 'This menu is out of date. Run `/help` again.' },
  noCommand: { ru: 'Такой команды нет. Начните вводить название и выберите из списка.', en: 'There is no such command. Start typing a name and pick one from the list.' },
  usage: { ru: 'Как пользоваться', en: 'Usage' },
  examples: { ru: 'Примеры', en: 'Examples' },
  needs: { ru: 'Что нужно', en: 'Requirements' },
  section: { ru: 'Раздел', en: 'Section' },
  adminOnly: { ru: 'Только для администраторов', en: 'Administrators only' },
  noNews: { ru: 'Не удалось загрузить список изменений. Попробуйте чуть позже.', en: 'Could not load the list of changes. Try again later.' },
  unlinked: { ru: '🔗 Ник не привязан: команда `/link` подключит часы, ранг и достижения.', en: '🔗 No nick linked yet: `/link` turns on hours, rank and achievements.' },
  back: { ru: 'Назад', en: 'Back' },
  askCmd: { ru: 'Справка по команде…', en: 'Help for a command…' },
  noAnswer: { ru: '💬 Не нашли ответ? Подробности по команде: `/help command:…`', en: '💬 Did not find the answer? Details of a command: `/help command:…`' },
  openCard: { ru: 'Открыть карточку сервера…', en: 'Open a server card…' },
  linkNick: { ru: 'Привязать ник', en: 'Link my nick' },
  topWeek: { ru: 'Топ недели', en: 'Top of the week' },
  topMonth: { ru: 'Топ месяца', en: 'Top of the month' },
  cases: { ru: 'Последние наказания', en: 'Latest punishments' },
  noCases: { ru: 'Наказаний пока нет.', en: 'No punishments yet.' },
  casesTitle: { ru: '📋 Последние наказания', en: '📋 Latest punishments' },
  panelDown: { ru: 'Панель сейчас не отвечает. Попробуйте чуть позже.', en: 'The panel is not answering now. Try again later.' },
} satisfies Record<string, Two>;
export const tx = (k: keyof typeof UI, lang: Lang): string => UI[k][lang];

export interface LiveServer { id: number; name: string; online: boolean; players: number; maxPlayers: number; map: string | null }
export interface Live { players: number; up: number; total: number; servers?: LiveServer[] }
export const liveLine = (l: Live, lang: Lang): string => {
  const dot = l.up === l.total && l.total > 0 ? '🟢' : l.up === 0 ? '🔴' : '🟡';
  return lang === 'en' ? `${dot} Playing now: **${l.players}** · servers online: **${l.up} of ${l.total}**` : `${dot} Сейчас играют **${l.players}** · серверов в сети **${l.up} из ${l.total}**`;
};

/** the short form of a command note for the lists: up to the first «:», «,» or bracket, at most 48 characters */
export function shortText(text: string, max = 48): string {
  const cut = text.search(/[:,(]/);
  const s = (cut > 8 ? text.slice(0, cut) : text).trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export interface MeLike { found: boolean; gameNick: string; rank: { name: string; hours: number } | null }
/** the line about the person on the first screen: their nick, rank and hours, or a hint to link the nick */
export function meLine(me: MeLike | null, lang: Lang): string {
  if (!me) return '';
  if (!me.found || !me.gameNick) return tx('unlinked', lang);
  const hours = me.rank ? ` · ${me.rank.name} · ${Number.isInteger(me.rank.hours) ? me.rank.hours : me.rank.hours.toFixed(1)} ${lang === 'en' ? 'h' : 'ч'}` : '';
  return `👤 **${me.gameNick}**${hours}`;
}

export interface ChangelogAnswer { version: string | null; date: string | null; items: string[] }
/** the first words of a changelog item: up to the first « — », « | » or full stop, cut at `max` characters */
export function shortItem(text: string, max = 130): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const cut = t.search(/ — | \| |\. /);
  const s = cut > 10 ? t.slice(0, cut) : t;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
