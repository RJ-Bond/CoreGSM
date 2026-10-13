/** Maintenance windows: types and the pure helpers (validation, quick presets, labels) used by the admin page and the server views. */

export type MaintenanceRepeat = 'none' | 'daily' | 'weekly';

export interface MaintenanceWindow {
  id: number;
  serverId: number | null;
  serverName: string | null;
  name: string;
  startTs: number;
  endTs: number;
  repeat: MaintenanceRepeat;
  createdBy?: string | null;
  createdAt?: number;
  active: boolean;
  until: number | null;
  nextStart: number | null;
}

export interface MaintenanceInput {
  serverId: number | null;
  name: string;
  startTs: number;
  endTs: number;
  repeat: MaintenanceRepeat;
}

export const MAX_WINDOW_MS = 7 * 24 * 3600_000;
export const MAX_DAILY_MS = 24 * 3600_000;
export const NAME_MAX = 80;

/** the first problem with the form, or null when it can be sent */
export function validateWindow(v: { name: string; startTs: number | null; endTs: number | null; repeat: MaintenanceRepeat }): string | null {
  const name = v.name.trim();
  if (!name) return 'Введите название работ';
  if (name.length > NAME_MAX) return `Название длиннее ${NAME_MAX} символов`;
  if (v.startTs == null || Number.isNaN(v.startTs)) return 'Укажите начало';
  if (v.endTs == null || Number.isNaN(v.endTs)) return 'Укажите окончание';
  if (v.endTs <= v.startTs) return 'Окончание должно быть позже начала';
  const len = v.endTs - v.startTs;
  if (len > MAX_WINDOW_MS) return 'Окно не может быть длиннее 7 суток';
  if (v.repeat === 'daily' && len > MAX_DAILY_MS) return 'При ежедневном повторе окно не может быть длиннее 24 часов';
  return null;
}

/** «Сейчас на 30 минут» */
export function presetNow(now: number, minutes = 30): { startTs: number; endTs: number } {
  const start = Math.floor(now / 60_000) * 60_000;
  return { startTs: start, endTs: start + minutes * 60_000 };
}

/** «Сегодня ночью 04:00–05:00»: the coming 04:00 (today when it has not passed yet, otherwise tomorrow) for one hour */
export function presetTonight(now: number, startHour = 4, hours = 1): { startTs: number; endTs: number } {
  const d = new Date(now);
  d.setHours(startHour, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  const startTs = d.getTime();
  return { startTs, endTs: startTs + hours * 3600_000 };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** ts -> value of <input type="datetime-local"> in the browser's zone */
export function toLocalInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** value of <input type="datetime-local"> -> ts, null when empty or invalid */
export function fromLocalInput(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

export const REPEAT_LABEL: Record<MaintenanceRepeat, string> = { none: 'Один раз', daily: 'Каждый день', weekly: 'Каждую неделю' };

const clock = (ts: number) => `${p2(new Date(ts).getHours())}:${p2(new Date(ts).getMinutes())}`;

/** «до 05:00», or «до 14.10 05:00» when the end is not today */
export function untilLabel(until: number, now = Date.now(), clockOf: (ts: number) => string = clock): string {
  const d = new Date(until);
  const t = new Date(now);
  const same = d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  return same ? `до ${clockOf(until)}` : `до ${p2(d.getDate())}.${p2(d.getMonth() + 1)} ${clockOf(until)}`;
}

/** the text of the chip on cards and in the passport */
export function chipText(m: { until: number | null }, now = Date.now(), clockOf?: (ts: number) => string): string {
  return m.until ? `Тех. работы ${untilLabel(m.until, now, clockOf)}` : 'Тех. работы';
}

/** a short «с 04:00 до 05:00» / «14.10 04:00 – 15.10 05:00» range */
export function rangeLabel(startTs: number, endTs: number): string {
  const day = (ts: number) => `${p2(new Date(ts).getDate())}.${p2(new Date(ts).getMonth() + 1)}`;
  const a = new Date(startTs);
  const b = new Date(endTs);
  const same = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  return same ? `${day(startTs)}, ${clock(startTs)} – ${clock(endTs)}` : `${day(startTs)} ${clock(startTs)} – ${day(endTs)} ${clock(endTs)}`;
}

export type WindowState = 'active' | 'repeat' | 'planned' | 'past';

export function windowState(w: Pick<MaintenanceWindow, 'active' | 'repeat' | 'endTs' | 'nextStart'>, now = Date.now()): WindowState {
  if (w.active) return 'active';
  if (w.repeat !== 'none') return 'repeat';
  return w.endTs > now ? 'planned' : 'past';
}
