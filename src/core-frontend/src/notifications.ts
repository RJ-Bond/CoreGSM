import { useEffect, useState } from 'react';
import { api, ApiError } from './api';

/** what a player can be told about a server */
export type SubKind = 'free_slot' | 'back_online' | 'went_down';
export const SUB_KINDS: SubKind[] = ['free_slot', 'back_online', 'went_down'];

/** GET /me/subscriptions */
export interface Subscription { serverId: number; kinds: SubKind[] }

/** GET /me/notifications */
export interface NotificationItem { id: number; ts: number; kind: string; serverId: number | null; text: string; read: boolean }
export interface NotificationList { unread: number; items: NotificationItem[] }

/** the badge on the bell: nothing for 0, the number up to 99, then «99+» */
export function badgeText(n: number | null | undefined): string {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return '';
  return v > 99 ? '99+' : String(v);
}

/** keeps only known kinds, once each, in the canonical order */
export function normalizeKinds(raw: unknown): SubKind[] {
  const list = Array.isArray(raw) ? raw : [];
  return SUB_KINDS.filter((k) => list.includes(k));
}

/** the selection with one kind switched on or off (canonical order, no duplicates) */
export function toggleKind(kinds: readonly SubKind[], kind: SubKind): SubKind[] {
  const has = kinds.includes(kind);
  return normalizeKinds(has ? kinds.filter((k) => k !== kind) : [...kinds, kind]);
}

/** the notification links to its server page, or nowhere */
export function notificationHref(n: Pick<NotificationItem, 'serverId'>): string | null {
  return n.serverId != null && Number.isFinite(Number(n.serverId)) ? `#/servers/${n.serverId}` : null;
}

/** an "unavailable" answer (older backend, feature off) hides the panel instead of showing an error */
export const isUnavailable = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 501);

export const NOTIFY_POLL_MS = 60_000;

export const fetchNotifications = (unreadOnly = false, limit = 50) =>
  api<NotificationList>(`/me/notifications?${unreadOnly ? 'unread=1&' : ''}limit=${limit}`);

export const markNotificationsRead = (body: { ids: number[] } | { all: true }) =>
  api<{ ok: boolean; unread: number }>('/me/notifications/read', 'POST', body);

/** all subscriptions of the signed-in user; null while loading, undefined-less: `unavailable` when the backend has no such feature */
export function useSubscriptions(enabled: boolean): { list: Subscription[] | null; unavailable: boolean; set: (s: Subscription) => void } {
  const [list, setList] = useState<Subscription[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!enabled) { setList(null); return; }
    let dead = false;
    api<Subscription[]>('/me/subscriptions')
      .then((r) => { if (!dead) setList((Array.isArray(r) ? r : []).map((s) => ({ serverId: Number(s.serverId), kinds: normalizeKinds(s.kinds) }))); })
      .catch((e) => { if (!dead) { setList([]); setUnavailable(isUnavailable(e) || !(e instanceof ApiError)); } });
    return () => { dead = true; };
  }, [enabled]);
  const set = (s: Subscription) => setList((cur) => [...(cur ?? []).filter((x) => x.serverId !== s.serverId), s]);
  return { list, unavailable, set };
}
