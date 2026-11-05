/** «🔔 Следить» buttons under server and player cards: ids and texts. No discord.js import. */

export type FollowId = { kind: 'server'; id: number; on: boolean } | { kind: 'player'; nick: string; on: boolean };

export const followId = (kind: 'server' | 'player', key: string | number, on: boolean): string => `fol:${on ? '' : 'u'}${kind === 'server' ? 's' : 'p'}:${String(key).slice(0, 64)}`;

export function parseFollow(id: string): FollowId | null {
  const m = /^fol:(u?)(s|p):(.{1,64})$/s.exec(id);
  if (!m) return null;
  const on = m[1] !== 'u';
  if (m[2] === 's') return /^\d{1,9}$/.test(m[3] as string) ? { kind: 'server', id: Number(m[3]), on } : null;
  return { kind: 'player', nick: (m[3] as string).trim(), on };
}

export interface FollowAnswer {
  status: 'ok' | 'unlinked' | 'notfound' | 'limit';
  on?: boolean;
  name?: string;
  max?: number;
}

/** the title and the text of the private answer */
export function followText(a: FollowAnswer, f: FollowId): { title: string; text: string; ok: boolean } {
  if (a.status === 'unlinked') return { title: 'Нужен аккаунт', text: 'Следить можно с аккаунтом панели, привязанным к Discord. Создайте его командой `/register` или `/link`.', ok: false };
  if (a.status === 'notfound') return { title: f.kind === 'server' ? 'Сервер не найден' : 'Игрок не найден', text: 'Возможно, его уже нет в списке.', ok: false };
  if (a.status === 'limit') return { title: 'Слишком много подписок', text: `Можно следить не больше чем за ${a.max ?? 30} игроками. Отпишитесь от лишних в профиле.`, ok: false };
  const name = a.name ?? '';
  if (f.kind === 'server') {
    return a.on
      ? { title: `🔔 Вы следите за «${name}»`, text: 'Напишу в личные сообщения, когда на сервере освободится место, он вернётся в сеть или станет недоступен.', ok: true }
      : { title: `🔕 Вы больше не следите за «${name}»`, text: 'Уведомления об этом сервере отключены.', ok: true };
  }
  return a.on
    ? { title: `🔔 Вы следите за игроком ${name}`, text: 'Напишу в личные сообщения, когда он зайдёт на любой сервер (не чаще раза в 30 минут).', ok: true }
    : { title: `🔕 Вы больше не следите за ${name}`, text: 'Уведомления об этом игроке отключены.', ok: true };
}
