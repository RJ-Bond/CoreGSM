/** Scheduled announcements for a Discord channel: checking the form and working out the next run. Pure. */
export type Repeat = 'none' | 'daily' | 'weekly';
export const REPEATS: readonly Repeat[] = ['none', 'daily', 'weekly'];
export const MAX_TEXT = 1800;
export const MAX_ACTIVE = 50;

export interface AnnouncementInput { title: string; text: string; channelId: string; mention: 'none' | 'here' | 'everyone'; at: number; repeat: Repeat }

const STEP: Record<Exclude<Repeat, 'none'>, number> = { daily: 86_400_000, weekly: 7 * 86_400_000 };

/** the form is fine, or the reason it is not */
export function validateAnnouncement(i: unknown, now = Date.now()): { ok: true; value: AnnouncementInput } | { ok: false; error: string } {
  const v = i as Partial<AnnouncementInput> | null;
  if (!v || typeof v !== 'object') return { ok: false, error: 'Неверные данные' };
  const text = typeof v.text === 'string' ? v.text.trim() : '';
  if (!text) return { ok: false, error: 'Введите текст объявления' };
  if (text.length > MAX_TEXT) return { ok: false, error: `Текст не длиннее ${MAX_TEXT} символов` };
  const channelId = typeof v.channelId === 'string' ? v.channelId.trim() : '';
  if (!/^\d{15,25}$/.test(channelId)) return { ok: false, error: 'Выберите канал Discord' };
  const at = Number(v.at);
  if (!Number.isFinite(at) || at < now - 60_000 || at > now + 366 * 86_400_000) return { ok: false, error: 'Укажите время в будущем, не дальше года' };
  const repeat = REPEATS.includes(v.repeat as Repeat) ? (v.repeat as Repeat) : 'none';
  const mention = v.mention === 'here' || v.mention === 'everyone' ? v.mention : 'none';
  const title = typeof v.title === 'string' ? v.title.trim().slice(0, 100) : '';
  return { ok: true, value: { title, text, channelId, mention, at: Math.round(at), repeat } };
}

/** when it runs after the run at `at`; null when it does not repeat. A panel that was off for days does not send a pile: the next run is in the future */
export function nextRun(at: number, repeat: Repeat, now: number): number | null {
  if (repeat === 'none') return null;
  const step = STEP[repeat];
  let n = at + step;
  if (n <= now) n += Math.ceil((now - n) / step) * step;
  return n;
}
