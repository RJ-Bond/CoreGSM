import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../i18n';
import { IconBell, ago } from '../ui';
import {
  NOTIFY_POLL_MS, badgeText, fetchNotifications, isUnavailable, markNotificationsRead, notificationHref,
  type NotificationItem,
} from '../notifications';

/**
 * The bell in the header: unread badge and a popover with the latest notifications.
 * The unread count is refreshed every minute while the tab is visible (no animation on the bell itself).
 * A backend without the feature (404) hides the bell instead of showing an error.
 */
export default function NotificationBell({ initialUnread = 0 }: { initialUnread?: number }) {
  const [unread, setUnread] = useState(Math.max(0, initialUnread));
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [gone, setGone] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const popId = useId();
  openRef.current = open;

  // /me brings a fresh number on every reload of the session; keep the larger knowledge of the two out of the way
  useEffect(() => { setUnread(Math.max(0, initialUnread)); }, [initialUnread]);

  const loadList = useCallback(async () => {
    try {
      const r = await fetchNotifications(false, 50);
      setItems(Array.isArray(r.items) ? r.items : []);
      setUnread(Math.max(0, Number(r.unread) || 0));
      setFailed(false);
    } catch (e) {
      if (isUnavailable(e)) setGone(true);
      else setFailed(true);
      setItems((cur) => cur ?? []);
    }
  }, []);

  // the poll: only the number while closed, the whole list while the popover is open
  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      if (openRef.current) { void loadList(); return; }
      fetchNotifications(true, 1)
        .then((r) => setUnread(Math.max(0, Number(r.unread) || 0)))
        .catch((e) => { if (isUnavailable(e)) setGone(true); });
    };
    const timer = window.setInterval(tick, NOTIFY_POLL_MS);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [loadList]);

  const close = useCallback((back: boolean) => {
    setOpen(false);
    if (back) btn.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const toggle = () => {
    if (open) { close(false); return; }
    setOpen(true);
    setFailed(false);
    void loadList();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
  };

  const readOne = (n: NotificationItem) => {
    setOpen(false);
    if (n.read) return;
    setItems((cur) => cur?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? cur);
    setUnread((u) => Math.max(0, u - 1));
    markNotificationsRead({ ids: [n.id] }).then((r) => setUnread(Math.max(0, Number(r.unread) || 0))).catch(() => undefined);
  };
  const readAll = () => {
    setItems((cur) => cur?.map((x) => ({ ...x, read: true })) ?? cur);
    setUnread(0);
    markNotificationsRead({ all: true }).then((r) => setUnread(Math.max(0, Number(r.unread) || 0))).catch(() => void loadList());
  };

  if (gone) return null;
  const badge = badgeText(unread);
  const label = unread > 0 ? t('bell.ariaUnread', { n: unread }) : t('bell.aria');

  return (
    <div ref={root} onKeyDown={onKey} onBlur={(e) => { if (open && e.relatedTarget && !root.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        className="relative grid place-items-center rounded-full bg-soft font-semibold text-mute transition hover:text-ink max-sm:h-11 max-sm:w-11 sm:h-10 sm:w-10"
        aria-label={label}
        title={t('bell.title')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
      >
        <IconBell size={20} />
        {badge && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-bad px-1 text-center text-[11px] font-extrabold leading-[18px] text-white shadow-[0_0_0_2px_rgb(var(--card))]" aria-hidden>
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={pop}
          id={popId}
          role="dialog"
          aria-label={t('bell.title')}
          className="panel panel-raised absolute right-0 top-full z-40 mt-2 w-[min(24rem,100%)] overflow-hidden"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <h2 className="text-base font-black">{t('bell.title')}</h2>
            <button type="button" className="rounded-full px-2 py-1.5 text-sm font-extrabold text-link hover:underline disabled:opacity-50 max-sm:min-h-[44px]" onClick={readAll} disabled={unread === 0}>
              {t('bell.readAll')}
            </button>
          </div>
          <div className="max-h-[min(26rem,70dvh)] overflow-y-auto overscroll-contain">
            {items === null && <div className="skeleton m-3 h-16 rounded-2xl bg-soft" aria-hidden />}
            {failed && <p className="px-4 py-3 text-sm font-bold text-bad" role="alert">{t('bell.loadError')}</p>}
            {items && items.length === 0 && !failed && <p className="px-4 py-8 text-center font-semibold text-mute">{t('bell.empty')}</p>}
            {items && items.length > 0 && (
              <ul className="divide-y divide-line">
                {items.map((n) => {
                  const href = notificationHref(n);
                  const body = (
                    <>
                      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-brand'}`} />
                      <span className="min-w-0 flex-1">
                        <span className={`block break-words text-sm leading-snug ${n.read ? 'font-semibold text-mute' : 'font-extrabold'}`}>
                          {!n.read && <span className="sr-only">{t('bell.unreadMark')} </span>}
                          {n.text}
                        </span>
                        <span className="mt-0.5 block text-xs font-semibold text-mute">{ago(n.ts)}</span>
                      </span>
                    </>
                  );
                  const cls = 'flex items-start gap-3 px-4 py-3 text-left transition hover:bg-soft max-sm:min-h-[44px]';
                  return (
                    <li key={n.id}>
                      {href ? (
                        <a href={href} className={cls} onClick={() => readOne(n)}>{body}</a>
                      ) : (
                        <button type="button" className={`${cls} w-full`} onClick={() => readOne(n)}>{body}</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
