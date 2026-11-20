/**
 * «Проверить запись из Discord»: why a line written in the chat channel may not reach the game.
 * The bot drops a message without a word when something is missing (a channel that is not listened to, no right to read the text,
 * a writer who is not an administrator), so the panel lists what it can see: the settings, the bot, the channel and the last attempts.
 *   GET /api/game-news/say-check   (administrators)
 */
import type { Express, RequestHandler } from 'express';
import { db } from '../db.js';
import { bot } from '../discord/botState.js';
import { chatChannels } from './gameNewsChat.js';

export interface SayAttempt { ts: number; name: string; status: 'sent' | 'empty' | 'denied' | 'rate'; why: string }
const attempts: SayAttempt[] = [];

/** what became of a line the bot handed over (the last twenty are kept in memory) */
export function noteSayAttempt(a: SayAttempt): void {
  attempts.unshift(a);
  if (attempts.length > 20) attempts.length = 20;
}
export const resetSayAttempts = (): void => { attempts.length = 0; };

export interface SayCheck { id: string; /** null = cannot be said from here */ ok: boolean | null; text: string; fix?: string }

/** the list of checks, in the order a person should look at them */
export function sayChecks(now = Date.now()): { checks: SayCheck[]; attempts: SayAttempt[] } {
  const channels = chatChannels();
  const checks: SayCheck[] = [];

  checks.push(channels.length > 0
    ? { id: 'channel', ok: true, text: `Бот слушает каналов: ${channels.length}` }
    : { id: 'channel', ok: false, text: 'Ни один канал не слушается', fix: 'Включите «Пересылать чат игры в Discord», добавьте адрес webhook канала и включите «Писать из Discord в игру». Серверам нужен токен плагина.' });

  const servers = new Set(channels.flatMap((c) => c.serverIds));
  checks.push(servers.size > 0
    ? { id: 'servers', ok: true, text: `Строки пойдут на серверов: ${servers.size}` }
    : { id: 'servers', ok: false, text: 'Нет серверов с плагином для этого канала', fix: 'Создайте токен плагина у сервера («Игровой плагин» → «Настроить»).' });

  const st = bot.status;
  checks.push(st.state === 'online'
    ? { id: 'bot', ok: true, text: `Бот на связи${st.tag ? `: ${st.tag}` : ''}` }
    : st.state === 'error'
      ? { id: 'bot', ok: false, text: `Бот не вошёл в Discord: ${st.error ?? 'ошибка'}`, fix: 'Если там сказано про Intents: Developer Portal → ваше приложение → Bot → Privileged Gateway Intents → включить «Message Content Intent», сохранить и подождать минуту.' }
      : { id: 'bot', ok: false, text: st.state === 'connecting' ? 'Бот ещё входит в Discord' : 'Бот не запущен', fix: 'Проверьте токен бота в «Админка → Discord».' });

  if (channels.length > 0 && bot.guilds.length > 0) {
    const seen = channels.map((c) => {
      for (const g of bot.guilds) {
        const ch = g.channels.find((x) => x.id === c.channelId);
        if (ch) return { id: c.channelId, guild: g.name, name: ch.name, missing: ch.missing ?? [] };
      }
      return { id: c.channelId, guild: '', name: '', missing: [] as string[] };
    });
    const hidden = seen.filter((x) => !x.name);
    const lacking = seen.filter((x) => x.name && x.missing.length > 0);
    checks.push(hidden.length === 0 && lacking.length === 0
      ? { id: 'visible', ok: true, text: `Бот видит канал: #${seen[0]?.name}` }
      : { id: 'visible', ok: false, text: hidden.length > 0 ? 'Бот не видит канал (нет права «Просмотр канала» или канала нет на сервере)' : `В канале #${lacking[0]!.name} боту не хватает прав: ${lacking[0]!.missing.join(', ')}`, fix: 'Дайте боту в этом канале права: просмотр канала, чтение истории, отправка сообщений, добавление реакций.' });
  } else {
    checks.push({ id: 'visible', ok: null, text: 'Видит ли бот канал, пока неизвестно (бот ещё не прислал список каналов)' });
  }

  const admins = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND discord_id IS NOT NULL AND discord_id <> ''").get() as { n: number }).n;
  checks.push({ id: 'writers', ok: null, text: admins > 0 ? `Писать в игру могут: администраторы Discord-сервера и ${admins} админ(ов) панели с привязанным Discord` : 'Писать в игру могут только администраторы Discord-сервера (право «Администратор»); у админов панели Discord не привязан', fix: admins > 0 ? undefined : 'Привяжите Discord в профиле администратора, если у вас нет права «Администратор» на сервере Discord.' });

  const recent = attempts.filter((a) => now - a.ts < 10 * 60_000);
  checks.push(recent.length > 0
    ? { id: 'attempts', ok: recent.some((a) => a.status === 'sent' || a.status === 'empty') ? true : null, text: `Строк от бота за 10 минут: ${recent.length}` }
    : { id: 'attempts', ok: null, text: 'За последние 10 минут бот не передал ни одной строки', fix: 'Напишите сообщение в канале и нажмите «Проверить» ещё раз. Если после этого по-прежнему ноль, бот не читает текст (проверьте «Message Content Intent») или вы пишете не в том канале, чей webhook указан здесь.' });
  return { checks, attempts: attempts.slice(0, 10) };
}

export function registerSayCheck({ app, admin }: { app: Express; admin: RequestHandler }): void {
  app.get('/api/game-news/say-check', admin, (_req, res) => {
    res.json(sayChecks());
  });
}
