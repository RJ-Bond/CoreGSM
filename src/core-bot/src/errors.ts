/** Discord and network failures: texts for the panel, rate limits, retries of dropped connections. No discord.js import. */
import { log } from './log.js';

/** Turns Discord/network errors into a message a person can act on (shown in the panel). */
export function humanDiscordError(e: unknown): string {
  const err = e as { code?: number | string; message?: string };
  const m = String(err?.message ?? e);
  switch (err?.code) {
    case 50001: return 'У бота нет доступа к каналу. Пригласите бота на этот сервер и выдайте права на канал.';
    case 10003: return 'Канал не найден. Проверьте ID и что бот приглашён на сервер, где находится канал.';
    case 50013: return 'Не хватает прав: боту нужны «Отправка сообщений», «Прикрепление файлов» и «Встраивание ссылок» в этом канале.';
    case 50035: return 'Discord отклонил сообщение: проверьте ссылки (они должны начинаться с http:// или https://) и длину текстов.';
    case 10008: return 'Сообщение уже удалено в Discord.';
    case 'TokenInvalid': return 'Токен неверный или сброшен. Получите новый: Developer Portal → Bot → Reset Token.';
  }
  if (/invalid token|token.*invalid/i.test(m)) return 'Токен неверный или сброшен. Получите новый: Developer Portal → Bot → Reset Token.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|timeout|socks|proxy/i.test(m)) {
    return 'Нет связи с Discord. Проверьте интернет сервера или настройте прокси в разделе «Настройки».';
  }
  return m.slice(0, 200);
}

/** Discord 429: how long to wait (ms), or 0 when the error is not a rate limit. */
export function retryAfterOf(e: unknown): number {
  const err = e as { status?: number; retryAfter?: number; timeToReset?: number; rawError?: { retry_after?: number }; code?: number | string };
  if (err?.status !== 429 && err?.code !== 429 && err?.timeToReset === undefined) return 0;
  const sec = err.rawError?.retry_after;
  const ms = err.retryAfter ?? err.timeToReset ?? (typeof sec === 'number' ? sec * 1000 : 0);
  return Math.max(1000, Math.round(ms || 5000));
}

/** Short reason stored in the delivery log; `final` = retrying cannot help. */
export function deliveryFailure(e: unknown): { text: string; final: boolean; retryAfterMs?: number } {
  const code = (e as { code?: number | string })?.code;
  const wait = retryAfterOf(e);
  if (wait) return { text: 'превышен лимит запросов Discord', final: false, retryAfterMs: wait };
  switch (code) {
    case 50007: return { text: 'пользователь закрыл ЛС', final: true };
    case 10013: return { text: 'пользователь не найден', final: true };
    case 50001:
    case 50013: return { text: 'нет прав', final: false };
    case 10003: return { text: 'канал не найден', final: false };
  }
  return { text: humanDiscordError(e).slice(0, 200), final: false };
}

/** Discord drops a second create-message with the same nonce (within a few minutes): retries are safe */
export const newNonce = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 25);

/** the same id always gives the same nonce: a retry of one alert or one news item cannot post a second copy */
export const stableNonce = (kind: string, id: number | string): string => `${kind}${id}`.slice(0, 25);

/**
 * Discord says that the message itself is gone (10008 «Unknown Message»). Only then is a new post right: a timeout, a
 * 5xx or a rate limit while editing says nothing about the old message, and posting then leaves two of them.
 */
export const isMessageGone = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === 10008;

/** a pooled connection that the proxy closed under us: the request never reached Discord, so one more try is safe */
export const SOCKET_ERR = /other side closed|UND_ERR_SOCKET|ECONNRESET|socket hang up|EPIPE|terminated|operation was aborted|AbortError|timed out|ETIMEDOUT/i;

export async function retrySocket<T>(fn: () => Promise<T>, tries = 3, delayMs = 300): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const err = e as Error & { code?: string; cause?: { message?: string; code?: string } };
      const text = `${err.message} ${err.code ?? ''} ${err.cause?.message ?? ''} ${err.cause?.code ?? ''}`;
      if (i >= tries || !SOCKET_ERR.test(text)) throw e;
      log(`connection to Discord failed (${err.message}), retry ${i}/${tries - 1}`);
      await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
}
