/** The welcome message for new members of the Discord server: the default text and the placeholders. */
export const DEFAULT_WELCOME = 'Добро пожаловать, {user}! 👋 Чтобы связать игровой ник с Discord и попасть в рейтинг, зарегистрируйтесь командой /register.';
export const MAX_WELCOME = 1000;

/** {user} → a mention, {server} → the name of the Discord server; unknown placeholders stay as they are */
export function renderWelcome(text: string, v: { userId: string; server: string }): string {
  const src = text.trim() || DEFAULT_WELCOME;
  return src
    .replace(/\{user\}/g, `<@${v.userId.replace(/\D/g, '')}>`)
    .replace(/\{server\}/g, v.server.replace(/[*_~`|>@]/g, ''))
    .slice(0, 1900);
}
