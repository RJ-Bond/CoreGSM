/** Buttons under the private cards of the bot (`dmx:*`): ids and texts. No discord.js import. */

export type DmxAction = { kind: 'ack'; me: boolean } | { kind: 'mute'; serverId: number };

export const DMX_ID = /^dmx:(ack:(me|notme)|mute:\d{1,9})$/;

export function parseDmx(id: string): DmxAction | null {
  const m = /^dmx:(?:ack:(me|notme)|mute:(\d{1,9}))$/.exec(id);
  if (!m) return null;
  return m[1] ? { kind: 'ack', me: m[1] === 'me' } : { kind: 'mute', serverId: Number(m[2]) };
}

/** a button style by id: green «it was me», red «it was not me», grey for the rest (numbers of discord.js ButtonStyle) */
export const dmxStyle = (id: string): 2 | 3 | 4 => (id === 'dmx:ack:me' ? 3 : id === 'dmx:ack:notme' ? 4 : 2);

export const MUTE_HOURS = 24;

export const dmxText = (ru: boolean) => ({
  confirmed: ru ? '✅ Вход подтверждён' : '✅ Sign-in confirmed',
  notMeTitle: ru ? '🚨 Срочно защитите аккаунт' : '🚨 Protect the account now',
  notMeBody: ru
    ? '1. Смените пароль.\n2. В профиле завершите все чужие сеансы.\n3. Если нужна помощь, напишите администратору.'
    : '1. Change the password.\n2. End all unknown sessions in the profile.\n3. Ask an administrator if you need help.',
  muted: (h: number) => (ru ? `🔕 Заглушено на ${h} ч. Вернуть можно в настройках уведомлений.` : `🔕 Muted for ${h} h. You can turn it back on in the notification settings.`),
  failed: ru ? 'Не получилось, попробуйте позже.' : 'Did not work, try again later.',
});
