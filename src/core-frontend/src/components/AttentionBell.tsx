import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { t, type TKey } from '../i18n';

type Tone = 'bad' | 'warn' | 'info';
interface Item { id: string; tone: Tone; n?: number; text?: string; href: string }

const POLL_MS = 60_000;
const TITLE: Record<string, TKey> = {
  servers_down: 'att.servers_down', deliveries_dead: 'att.deliveries_dead', backup_none: 'att.backup_none', backup_old: 'att.backup_old',
  cert: 'att.cert', update: 'att.update', bot: 'att.bot', disk: 'att.disk', users_pending: 'att.users_pending', reports: 'att.reports', comments: 'att.comments',
};
const DOT: Record<Tone, string> = { bad: 'bg-bad', warn: 'bg-warn', info: 'bg-brand' };

/** «Needs attention» for administrators: a header button with a count and a list of what to look at, each line leads to its section */
export default function AttentionBell() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const popId = useId();

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Item[] }>('/admin/attention');
      setItems(Array.isArray(r.items) ? r.items : []);
      setFailed(false);
    } catch {
      setFailed(true);
      setItems((cur) => cur ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
    const tick = () => { if (!document.hidden) void load(); };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); }
  };

  const list = items ?? [];
  const worst: Tone | null = list.some((i) => i.tone === 'bad') ? 'bad' : list.some((i) => i.tone === 'warn') ? 'warn' : list.length ? 'info' : null;
  const count = list.length;
  const line = (i: Item) => {
    const key = TITLE[i.id];
    return key ? t(key, { n: i.n ?? 0, text: i.text ?? '' }) : i.id;
  };

  return (
    <div ref={root} onKeyDown={onKey}>
      <button
        ref={btn}
        type="button"
        className="btn-icon relative"
        aria-label={count > 0 ? t('att.ariaCount', { n: count }) : t('att.aria')}
        title={t('att.title')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => { setOpen((o) => !o); if (!open) void load(); }}
      >
        <Icon size={20}>
          <path d="M12 3 2.5 20h19L12 3Z" />
          <path d="M12 10v4.5" />
          <path d="M12 17.5h.01" />
        </Icon>
        {worst && (
          <span className={`absolute -right-1 -top-1 min-w-[18px] rounded-full px-1 text-center text-xs font-extrabold leading-[18px] text-white shadow-[0_0_0_2px_rgb(var(--card))] ${DOT[worst]}`} aria-hidden>
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div id={popId} role="dialog" aria-label={t('att.title')} className="panel panel-raised absolute right-0 top-full z-40 mt-2 w-[min(24rem,100%)] overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <h2 className="text-base font-black">{t('att.title')}</h2>
            <button type="button" className="btn-link" onClick={() => void load()}>{t('att.refresh')}</button>
          </div>
          <div className="max-h-[min(26rem,70dvh)] overflow-y-auto overscroll-contain">
            {items === null && <div className="skeleton m-3 h-16 rounded-2xl bg-soft" aria-hidden />}
            {failed && <p className="px-4 py-3 text-sm font-bold text-bad" role="alert">{t('att.loadError')}</p>}
            {items && list.length === 0 && !failed && <p className="px-4 py-8 text-center font-semibold text-mute">{t('att.empty')}</p>}
            {list.length > 0 && (
              <ul className="divide-y divide-line">
                {list.map((i) => (
                  <li key={i.id}>
                    <a href={i.href} className="flex items-start gap-3 px-4 py-3 text-left transition hover:bg-soft max-sm:min-h-[44px]" onClick={() => setOpen(false)}>
                      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[i.tone]}`} />
                      <span className="min-w-0 flex-1 wrap-break-word text-sm font-extrabold leading-snug">{line(i)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
