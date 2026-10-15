import { useEffect, useRef, useState } from 'react';
import { api, type NewsAction, type NewsCategory, type NewsChange, type NewsReaction, type Server } from '../../api';
import { t, useI18n } from '../../i18n';
import { GameAvatar, StatusPill, UserAvatar, toast, usePoll } from '../../ui';
import { IconClose } from '../../icons';
import { DiscordMd, ThemeCtx, type DTheme } from './DiscordMd';
import { CategoryIcon, ChangeIcon, PinIcon } from './NewsIcons';
import { CHANGE_ORDER, countdownText, fullReactions, groupChanges, toggleReaction, validActions, type RubricFilter } from './newsLogic';

/** the news text uses the panel's own colours (light and dark), not Discord's */
export const PANEL_THEME: DTheme = {
  name: 'light',
  outer: 'transparent',
  embed: 'transparent',
  embedBorder: 'transparent',
  text: 'rgb(var(--ink))',
  title: 'rgb(var(--ink))',
  muted: 'rgb(var(--mute))',
  link: 'rgb(var(--link))',
  code: 'rgb(var(--soft))',
  quote: 'rgb(var(--line))',
  spoilerHide: 'rgb(var(--soft))',
  spoilerShow: 'rgb(var(--soft))',
  mentionBg: 'rgb(var(--soft))',
  mentionFg: 'rgb(var(--link))',
  chipBg: 'rgb(var(--soft))',
};

export function NewsText({ text, fields, className = '' }: { text: string; fields?: { name: string; value: string }[]; className?: string }) {
  return (
    <ThemeCtx.Provider value={PANEL_THEME}>
      <div className={`nw-prose ${className}`}>
        {text && <DiscordMd text={text} />}
        {fields && fields.length > 0 && (
          <dl className="nf-fields">
            {fields.map((f, i) => (
              <div key={i}>
                <dt>{f.name}</dt>
                <dd><DiscordMd text={f.value} /></dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </ThemeCtx.Provider>
  );
}

// ---------- the clock: one tick per second while the tab is visible; text only ----------
export function useNow(enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    let timer = 0;
    const stop = () => window.clearInterval(timer);
    const start = () => {
      stop();
      setNow(Date.now());
      timer = window.setInterval(() => setNow(Date.now()), 1000);
    };
    const vis = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', vis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', vis);
    };
  }, [enabled]);
  return now;
}

export function Countdown({ at, label, compact = false }: { at: number; label?: string; compact?: boolean }) {
  const { lang } = useI18n();
  const live = at > Date.now();
  const now = useNow(live);
  const done = at - now <= 0;
  return (
    <span className={`nw-countdown ${done ? 'is-done' : ''} ${compact ? 'is-compact' : ''}`} role="timer">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" />
      </svg>
      <span className="tabular-nums">{countdownText(at, now, label ?? '', lang)}</span>
    </span>
  );
}

// ---------- chips ----------
export function categoryLabel(c: NewsCategory | RubricFilter): string {
  switch (c) {
    case 'all': return t('nw.rubric.all');
    case 'announcement': return t('nw.cat.announcement');
    case 'wipe': return t('nw.cat.wipe');
    case 'update': return t('nw.cat.update');
    case 'event': return t('nw.cat.event');
    case 'maintenance': return t('nw.cat.maintenance');
    default: return t('nw.cat.other');
  }
}

/** singular form on a card: «Вайп», «Обновление» */
export function categoryOne(c: NewsCategory): string {
  switch (c) {
    case 'announcement': return t('nw.kind.announcement');
    case 'wipe': return t('nw.kind.wipe');
    case 'update': return t('nw.kind.update');
    case 'event': return t('nw.kind.event');
    case 'maintenance': return t('nw.kind.maintenance');
    default: return t('nw.kind.other');
  }
}

export function CategoryChip({ category }: { category: NewsCategory }) {
  return (
    <span className={`nw-chip nw-tone-${category}`}>
      <CategoryIcon category={category} size={14} />
      {categoryOne(category)}
    </span>
  );
}

export function PinChip() {
  return (
    <span className="nw-chip nw-chip-pin">
      <PinIcon size={13} />
      {t('nw.pinned')}
    </span>
  );
}

export function roleLabel(role: 'admin' | 'moderator' | 'player' | null | undefined): string {
  return role === 'admin' ? t('nw.role.admin') : role === 'moderator' ? t('nw.role.moderator') : '';
}

export function AuthorLine({ name, icon, role }: { name: string; icon?: string | null; role?: 'admin' | 'moderator' | 'player' | null }) {
  const url = icon && /^https?:\/\//i.test(icon) ? icon : null;
  const badge = roleLabel(role);
  return (
    <span className="nf-author">
      <UserAvatar name={name} url={url} size={24} tone="brand" />
      <span className="nw-author-name">{name}</span>
      {badge && <span className={`nw-role nw-role-${role}`}>{badge}</span>}
    </span>
  );
}

// ---------- «Что изменилось» ----------
const CHANGE_KEY = { add: 'nw.change.add', fix: 'nw.change.fix', change: 'nw.change.change', remove: 'nw.change.remove' } as const;

export function ChangesBlock({ changes }: { changes: NewsChange[] | undefined }) {
  const groups = groupChanges(changes);
  if (groups.length === 0) return null;
  return (
    <section className="nw-changes" aria-label={t('nw.changes')}>
      <h2 className="nw-h2">{t('nw.changes')}</h2>
      <div className="nw-changes-grid">
        {CHANGE_ORDER.map((k) => {
          const g = groups.find((x) => x.kind === k);
          if (!g) return null;
          return (
            <div key={k} className={`nw-change nw-change-${k}`}>
              <h3 className="nw-change-head">
                <span className="nw-change-ico"><ChangeIcon kind={k} size={16} /></span>
                {t(CHANGE_KEY[k])}
              </h3>
              <ul>
                {g.items.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------- action buttons ----------
export function ActionButtons({ actions }: { actions: NewsAction[] | undefined }) {
  const list = validActions(actions);
  if (list.length === 0) return null;
  return (
    <div className="nw-actions">
      {list.map((a, i) => (
        <a key={i} className={i === 0 ? 'btn' : 'btn btn-soft'} href={a.url} target="_blank" rel="noopener noreferrer">
          {a.label}
          <span aria-hidden> ↗</span>
        </a>
      ))}
    </div>
  );
}

// ---------- gallery ----------
export function GalleryGrid({ urls, onOpen }: { urls: string[]; onOpen: (i: number) => void }) {
  if (urls.length === 0) return null;
  return (
    <section aria-label={t('nw.gallery')}>
      <h2 className="nw-h2">{t('nw.gallery')}</h2>
      <ul className={`nw-gallery nw-gallery-${Math.min(urls.length, 6)}`}>
        {urls.map((u, i) => (
          <li key={u + i}>
            <button type="button" className="nw-gal-item" onClick={() => onOpen(i)} aria-label={t('nw.img.open', { n: i + 1 })}>
              <img src={u} alt="" loading="lazy" decoding="async" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** the picture in a modal: Esc closes, arrows switch, no transforms */
export function GalleryViewer({ urls, index, onIndex, onClose }: { urls: string[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const n = urls.length;
  const go = (d: number) => onIndex((index + d + n) % n);
  const goRef = useRef(go);
  goRef.current = go;
  const closeFn = useRef(onClose);
  closeFn.current = onClose;
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeFn.current(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goRef.current(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goRef.current(1); }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, []);
  if (n === 0) return null;
  return (
    <div className="nw-viewer" role="dialog" aria-modal="true" aria-label={t('nw.gallery')} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <button ref={closeRef} type="button" className="nw-viewer-btn nw-viewer-close" onClick={onClose} aria-label={t('common.close')}><IconClose /></button>
      {n > 1 && <button type="button" className="nw-viewer-btn nw-viewer-prev" onClick={() => go(-1)} aria-label={t('nw.img.prev')}>‹</button>}
      <img className="nw-viewer-img" src={urls[index]} alt="" />
      {n > 1 && <button type="button" className="nw-viewer-btn nw-viewer-next" onClick={() => go(1)} aria-label={t('nw.img.next')}>›</button>}
      <div className="nw-viewer-count" aria-live="polite">{t('nw.img.of', { i: index + 1, n })}</div>
    </div>
  );
}

// ---------- live server cards ----------
/** public server list, refreshed with the page; failures are silent (the cards simply do not show) */
export function useNewsServers(ms = 30_000, enabled = true): Server[] | null {
  const [servers, setServers] = useState<Server[] | null>(null);
  usePoll(() => {
    if (!enabled) return undefined;
    return api<Server[]>('/servers').then((s) => { if (Array.isArray(s)) setServers(s); }).catch(() => undefined);
  }, ms);
  return servers;
}

export function StatusCards({ ids, servers }: { ids: number[]; servers: Server[] | null }) {
  if (!ids.length) return null;
  const shown = ids.map((id) => servers?.find((s) => s.id === id)).filter((s): s is Server => !!s);
  if (servers && shown.length === 0) return null;
  return (
    <section aria-label={t('nw.servers')}>
      <h2 className="nw-h2">{t('nw.servers')}</h2>
      <ul className="nw-srv-list">
        {!servers && ids.slice(0, 5).map((id) => <li key={id} className="skeleton nw-srv-skel" aria-hidden />)}
        {shown.map((s) => (
          <li key={s.id}>
            <a className="nw-srv" href={`/servers/${s.id}`}>
              <GameAvatar game={s.game} size={40} />
              <span className="nw-srv-main">
                <span className="nw-srv-name">{s.name}</span>
                <span className="nw-srv-meta">
                  <span className="tabular-nums">{s.online ? t('nw.srv.players', { n: s.players, max: s.maxPlayers }) : t('nw.srv.offline')}</span>
                  {s.online && s.ping != null && <span className="tabular-nums">{s.ping} {t('nw.srv.ms')}</span>}
                </span>
              </span>
              <StatusPill online={s.online} known={s.hasStatus} maintenance={!!s.maintenance} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- reactions ----------
export function Reactions({
  id, reactions, canReact, onChange,
}: {
  id: number;
  reactions: NewsReaction[] | undefined;
  canReact: boolean;
  onChange: (r: NewsReaction[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const list = fullReactions(reactions);
  const click = async (emoji: string) => {
    if (!canReact || busy) return;
    const prev = list;
    const { list: opt, next } = toggleReaction(prev, emoji);
    onChange(opt);
    setBusy(true);
    try {
      const r = await api<NewsReaction[] | { reactions?: NewsReaction[] }>(`/news/${id}/reaction`, 'PUT', { emoji: next });
      const arr = Array.isArray(r) ? r : r?.reactions;
      if (Array.isArray(arr)) onChange(fullReactions(arr));
    } catch {
      onChange(prev);
      toast(t('nw.react.error'), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="nw-react">
      <div className="nw-react-row" role="group" aria-label={t('nw.react.title')}>
        {list.map((r) => (
          <button key={r.emoji} type="button" className="nw-react-btn" aria-pressed={r.mine} disabled={!canReact} onClick={() => void click(r.emoji)}>
            <span aria-hidden className="nw-react-emoji">{r.emoji}</span>
            <span className="tabular-nums">{r.count}</span>
          </button>
        ))}
      </div>
      {!canReact && <p className="nw-react-hint">{t('nw.react.login')}</p>}
    </div>
  );
}
