/** The welcome message for new members of the Discord server: the default texts, the placeholders and the random pick. */
export const DEFAULT_WELCOME = 'Добро пожаловать, {user}! 👋 Чтобы связать игровой ник с Discord и попасть в рейтинг, зарегистрируйтесь командой /register.';
export const MAX_WELCOME = 1000;

/**
 * Funny greetings in the style of Discord's own «welcome» messages. Used while the text in the panel is empty: one of them
 * is picked at random (never the same one twice in a row). {count} is the member number; a line with it is skipped when
 * the number is unknown.
 */
export const FUNNY_WELCOMES: readonly string[] = [
  'Добро пожаловать, {user}! Надеемся, ты захватил пиццу 🍕',
  'Новый игрок {user} только что подключился к {server}! Прячьте печеньки 🍪',
  '{user} спрыгнул к нам с парашютом 🪂 Принимайте!',
  'Дикий {user} появился! 🌿 Кто пойдёт знакомиться?',
  '{user} зашёл «на минуточку». Все мы знаем, чем это кончится 😏',
  'Тревога! 🚨 В {server} проникло новое лицо — {user}. Встречайте!',
  'Добро пожаловать, {user}! Диван мягкий, чай горячий, сервер ждёт ☕',
  '{user} присоединился к нашему сообществу. Пицца не обязательна, но приветствуется 🍕',
  'Ура, {user} с нами! Скажите ему «привет», только не все сразу 👋',
  '{user} телепортировался в {server}. Проверьте инвентарь на пропажи 🎒',
  'Встречайте {user}! Лутбоксов нет, зато люди хорошие 🎁',
  'Новичок на горизонте! 🔭 {user}, располагайся и не стесняйся.',
  'Раз, два, три... {user} в игре! Респаун прошёл успешно 💫',
  '{user} вошёл как к себе домой, и мы совсем не против 🏠',
  'Привет, {user}! Ты у нас {count}-й. Билеты на выход закончились 🎟️',
  '{user}, добро пожаловать! Ты {count}-й участник: почти юбилейный 🎉',
];

/** shown under the funny default greetings, so the newcomer still learns how to get into the rating */
export const FUNNY_HINT = '-# Чтобы попасть в рейтинг, свяжите игровой ник с Discord командой /register';

/** the lines that separate your own variants in the text of the panel */
const SEPARATOR = /^[ \t]*---[ \t]*$/m;

export interface WelcomeVars {
  userId: string;
  server: string;
  /** the number of members of the Discord server, when the bot knows it */
  count?: number | null;
}

/**
 * the variants to pick from: the greetings written in the panel (split by a line with «---»), or the funny defaults
 * (`funny`). Variants with {count} are left out while the number of members is unknown.
 */
export function welcomeVariants(text: string, hasCount: boolean): { list: string[]; funny: boolean } {
  const usable = (s: string) => hasCount || !s.includes('{count}');
  const own = text
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);
  if (own.length) {
    const list = own.filter(usable);
    return { list: list.length ? list : [DEFAULT_WELCOME], funny: false };
  }
  return { list: FUNNY_WELCOMES.filter(usable), funny: true };
}

/** an index in 0..n-1 that differs from `last` whenever n > 1; `r` is a random number in [0, 1) */
export function pickIndex(n: number, r: number, last: number): number {
  if (n <= 1) return 0;
  const i = Math.min(n - 1, Math.max(0, Math.floor(r * n)));
  return i === last ? (i + 1) % n : i;
}

/** {user} → a mention, {server} → the name of the Discord server, {count} → the member number; unknown placeholders stay as they are */
export function renderVariant(src: string, v: WelcomeVars): string {
  const count = Number.isInteger(v.count) && (v.count as number) > 0 ? String(v.count) : '';
  return (src.trim() || DEFAULT_WELCOME)
    .replace(/\{user\}/g, `<@${v.userId.replace(/\D/g, '')}>`)
    .replace(/\{server\}/g, v.server.replace(/[*_~`|>@]/g, ''))
    .replace(/\{count\}/g, count)
    .slice(0, 1900);
}

/** a ready greeting: one of the variants, picked at random (`last` is the index used the time before) */
export function renderWelcome(text: string, v: WelcomeVars, rand: () => number = Math.random, last = -1): string {
  return renderWelcomePick(text, v, rand, last).content;
}

/**
 * The same with more: the index that was used (so that the caller can remember it) and `funny` when the funny defaults
 * were used. In a plain message (`embed` false) the hint about /register goes under such a greeting; an embed shows it
 * as a block of its own.
 */
export function renderWelcomePick(text: string, v: WelcomeVars, rand: () => number = Math.random, last = -1, embed = false): { content: string; index: number; funny: boolean } {
  const { list, funny } = welcomeVariants(text, Number.isInteger(v.count) && (v.count as number) > 0);
  const index = pickIndex(list.length, rand(), last);
  const body = renderVariant(list[index] ?? DEFAULT_WELCOME, v);
  return { content: funny && !embed ? `${body}\n${FUNNY_HINT}` : body, index, funny };
}
