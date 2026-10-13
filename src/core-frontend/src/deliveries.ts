/** Delivery queue (Discord): types and pure helpers for the «Доставка» card. */

export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'error' | 'dead';
export type DeliveryKind = 'news' | 'alert' | 'dm' | 'status';

export interface DeliveryItem {
  id: number;
  kind: DeliveryKind;
  refId: number | null;
  target: string;
  status: DeliveryStatus;
  attempts: number;
  nextTryAt: number | null;
  lastError: string | null;
  createdAt: number;
  sentAt: number | null;
  summary: string;
}

export interface DeliveryResponse {
  counts: Record<DeliveryStatus, number>;
  items: DeliveryItem[];
}

export const MAX_ATTEMPTS = 8;

export const STATUS_LABEL: Record<DeliveryStatus, string> = {
  pending: 'В очереди',
  sending: 'Отправляется',
  sent: 'Доставлено',
  error: 'Ошибка, повтор',
  dead: 'Не доставлено',
};

export const KIND_LABEL: Record<DeliveryKind, string> = {
  news: 'Новость',
  alert: 'Оповещение',
  dm: 'Личное сообщение',
  status: 'Карточка статуса',
};

/** «через 40 с», «через 3 мин», «через 2 ч 5 мин», «сейчас» */
export function countdownText(nextTryAt: number | null, now = Date.now()): string {
  if (nextTryAt == null) return '';
  const s = Math.ceil((nextTryAt - now) / 1000);
  if (s <= 0) return 'сейчас';
  if (s < 60) return `через ${s} с`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `через ${m} мин`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `через ${h} ч ${rest} мин` : `через ${h} ч`;
}

/** a retry is possible only for finished-with-trouble rows */
export const canRetry = (s: DeliveryStatus) => s === 'dead' || s === 'error';

export const attemptsText = (n: number, max = MAX_ATTEMPTS) => `${Math.min(n, max)}/${max}`;
