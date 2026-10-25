import { createElement, useEffect, useState } from 'react';
import { api, type PublicNews } from '../../api';
import { t } from '../../i18n';
import { unreadCount } from './newsLogic';

const KEY = 'coregsm_news_seen';
const EVENT = 'coregsm:news-seen';

/** the time of the last visit to the news page (null: never; the first visit starts the count and marks nothing) */
export function readSeen(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function markSeen(now = Date.now()): void {
  try { localStorage.setItem(KEY, String(now)); } catch { /* not remembered */ }
  window.dispatchEvent(new Event(EVENT));
}

/** how many news came after the last visit; polls rarely, and updates at once after a visit to /news */
export function useNewsUnread(enabled: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const run = () => {
      const seen = readSeen();
      // the first run only starts the count
      if (seen == null) { markSeen(); setN(0); return; }
      api<PublicNews[]>('/news?limit=30').then((list) => { if (alive && Array.isArray(list)) setN(unreadCount(list, seen)); }).catch(() => undefined);
    };
    run();
    const timer = window.setInterval(run, 120_000);
    window.addEventListener(EVENT, run);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener(EVENT, run); };
  }, [enabled]);
  return n;
}

/** the number of unread news beside «Новости» in the menu (nothing while there are none) */
export function NewsUnreadDot({ className = '' }: { className?: string }) {
  const n = useNewsUnread(true);
  if (n <= 0) return null;
  return createElement('span', { className: `nw-unread ${className}`, title: t('nw.unread', { n }), role: 'img', 'aria-label': t('nw.unread', { n }) }, n > 9 ? '9+' : String(n));
}
