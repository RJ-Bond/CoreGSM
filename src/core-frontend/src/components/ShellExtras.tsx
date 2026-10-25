/**
 * The extras of the app shell: the progress strip under the header, the live title and favicon, the footer, the
 * profile menu, the breadcrumbs, the «hide the bottom bar while scrolling down» hook, the scroll memory of the
 * «Back» button and the tooltips of icon buttons (also on a long press on a phone).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, onBusy, type Me } from '../api';
import { t } from '../i18n';
import { UserAvatar } from '../ui';
import '../styles/shell.css';

// ---------- progress strip ----------
/** a thin strip: grows while the page is changing, finishes when the page and its first requests are in */
export function RouteProgress({ routeKey }: { routeKey: string }) {
  const [phase, setPhase] = useState<'idle' | 'run' | 'done'>('idle');
  const first = useRef(true);
  const started = useRef(0);
  const inflight = useRef(0);
  useEffect(() => onBusy((n) => { inflight.current = n; }), []);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    started.current = Date.now();
    setPhase('run');
    const tick = window.setInterval(() => {
      const spent = Date.now() - started.current;
      if ((inflight.current === 0 && spent > 350) || spent > 2500) {
        window.clearInterval(tick);
        setPhase('done');
        window.setTimeout(() => setPhase('idle'), 350);
      }
    }, 120);
    return () => window.clearInterval(tick);
  }, [routeKey]);
  if (phase === 'idle') return null;
  return <div className={`route-progress is-${phase}`} role="progressbar" aria-label={t('hdr.loading')} aria-busy={phase === 'run'}><span /></div>;
}

// ---------- title and favicon ----------
let baseIcon: { href: string; el: HTMLLinkElement } | null = null;

function paintFavicon(state: 'ok' | 'bad' | null) {
  const el = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!el) return;
  if (!baseIcon) baseIcon = { href: el.href, el };
  if (!state) { baseIcon.el.href = baseIcon.href; return; }
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (!g || !baseIcon) return;
    g.drawImage(img, 0, 0, 64, 64);
    g.beginPath();
    g.arc(50, 50, 13, 0, Math.PI * 2);
    g.fillStyle = state === 'ok' ? '#22c55e' : '#ef4444';
    g.strokeStyle = '#fff';
    g.lineWidth = 4;
    g.fill();
    g.stroke();
    try { baseIcon.el.href = c.toDataURL('image/png'); } catch { /* the plain icon stays */ }
  };
  img.src = baseIcon.href;
}

interface Pulse { now: { players: number; online: number; servers: number } }

/** players now (for «(12) Серверы · CoreGSM») and a dot on the favicon: green when everything is up, red when something is down */
export function usePanelPulse(enabled: boolean): number {
  const [players, setPlayers] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const load = () => {
      if (document.hidden) return;
      api<Pulse>('/community').then((c) => {
        if (stop) return;
        setPlayers(c.now.players);
        paintFavicon(c.now.servers === 0 ? null : c.now.online === c.now.servers ? 'ok' : 'bad');
      }).catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, 60_000);
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { stop = true; window.clearInterval(id); document.removeEventListener('visibilitychange', vis); paintFavicon(null); };
  }, [enabled]);
  return players;
}

// ---------- footer ----------
export function AppFooter({ brand }: { brand: string }) {
  return (
    <footer className="app-foot">
      <span className="font-extrabold">{brand}</span>
      <nav aria-label={t('nav.sections')}>
        <a href="/servers">{t('nav.servers')}</a>
        <a href="/news">{t('nav.news')}</a>
        <a href="/status">{t('nav.status')}</a>
        <a href="/community">{t('nav.community')}</a>
        <a href="/gallery">Галерея</a>
      </nav>
    </footer>
  );
}

// ---------- breadcrumbs ----------
export function Crumbs({ items }: { items: [href: string, label: ReactNode][] }) {
  return (
    <nav className="crumbs" aria-label="Хлебные крошки">
      <ol>
        {items.map(([href, label], i) => (
          <li key={href + i}>
            {i < items.length - 1 ? <a href={href}>{label}</a> : <span aria-current="page">{label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ---------- profile menu ----------
export function ProfileMenu({ me, isStaff, logout, active }: { me: Me; isStaff: boolean; logout: () => void; active: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); box.current?.querySelector<HTMLElement>('button')?.focus(); } };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const link = 'pm-item';
  return (
    <div className="pm" ref={box}>
      <button
        type="button"
        className={`pm-btn ${active ? 'is-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('hdr.profileOf', { name: me.username })}
        onClick={() => setOpen((v) => !v)}
      >
        <UserAvatar name={me.username} url={me.avatarUrl} size={32} tone="grad" className="rounded-full!" />
        <span className="hidden truncate sm:inline">{me.username}</span>
      </button>
      {open && (
        <div className="pm-menu panel panel-raised" role="menu" onClick={() => setOpen(false)}>
          <div className="pm-head">
            <UserAvatar name={me.username} url={me.avatarUrl} size={40} tone="grad" className="rounded-full!" />
            <div className="min-w-0">
              <div className="truncate font-extrabold">{me.username}</div>
              <div className="text-xs font-bold text-mute">{me.role === 'admin' ? 'Администратор' : me.role === 'moderator' ? 'Модератор' : 'Игрок'}</div>
            </div>
          </div>
          <a role="menuitem" className={link} href="/profile">{t('hdr.profile')}</a>
          <a role="menuitem" className={link} href="/gallery">Моя галерея</a>
          {isStaff && <a role="menuitem" className={link} href="/admin">{t('nav.admin')}</a>}
          <button type="button" role="menuitem" className={`${link} is-danger`} onClick={logout}>{t('hdr.logout')}</button>
        </div>
      )}
    </div>
  );
}

// ---------- bottom bar: hidden while scrolling down ----------
export function useHideOnScroll(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let raf = 0;
    const f = () => {
      raf = 0;
      const y = window.scrollY;
      const d = y - last;
      const nearEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 80;
      if (y < 120 || nearEnd || d < -6) setHidden(false);
      else if (d > 10) setHidden(true);
      last = y;
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(f); };
    window.addEventListener('scroll', on, { passive: true });
    return () => { window.removeEventListener('scroll', on); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return hidden;
}

// ---------- scroll memory of «Back» ----------
const places = new Map<string, number>();
let here = '';
let popped = false;
let installed = false;
const keyOf = () => location.pathname + location.search;

function installScrollMemory() {
  if (installed) return;
  installed = true;
  here = keyOf();
  try { history.scrollRestoration = 'manual'; } catch { /* the browser decides */ }
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = (...a: Parameters<History['pushState']>) => { places.set(here, window.scrollY); push(...a); here = keyOf(); popped = false; };
  history.replaceState = (...a: Parameters<History['replaceState']>) => { replace(...a); here = keyOf(); };
  window.addEventListener('popstate', () => { places.set(here, window.scrollY); here = keyOf(); popped = true; });
}

/** after a step «Back» / «Forward»: scrolls to where the page was left, waiting until it is tall enough; false on a normal navigation */
export function restoreScroll(): boolean {
  installScrollMemory();
  if (!popped) return false;
  popped = false;
  const y = places.get(here);
  if (!y) return false;
  let tries = 0;
  const go = () => {
    window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) > 4 && tries++ < 30) window.setTimeout(go, 50);
  };
  go();
  return true;
}

export function useScrollMemory() {
  useEffect(() => { installScrollMemory(); }, []);
}

// ---------- tooltips of icon buttons ----------
/** the name of an icon-only button (no text of its own): data-tip, title or aria-label */
function tipOf(target: EventTarget | null): { el: HTMLElement; text: string } | null {
  const el = (target as Element | null)?.closest?.<HTMLElement>('button, a, [role="button"]');
  if (!el || el.textContent?.trim()) return null;
  const text = el.getAttribute('data-tip') || el.getAttribute('title') || el.getAttribute('aria-label');
  return text ? { el, text } : null;
}

export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    let timer = 0;
    let hold: { el: HTMLElement; title: string | null } | null = null;
    let swallow = false;
    const hide = () => {
      window.clearTimeout(timer);
      if (hold?.title != null) hold.el.setAttribute('title', hold.title);
      hold = null;
      setTip(null);
    };
    const show = (el: HTMLElement, text: string) => {
      const r = el.getBoundingClientRect();
      const below = r.top < 48;
      setTip({ text, x: Math.max(12, Math.min(window.innerWidth - 12, r.left + r.width / 2)), y: below ? r.bottom + 8 : r.top - 8, below });
    };
    const arm = (e: PointerEvent, delay: number) => {
      hide();
      const f = tipOf(e.target);
      if (!f) return;
      // our bubble replaces the native one (no two tips at once); the title comes back on hide
      hold = { el: f.el, title: f.el.getAttribute('title') };
      if (hold.title != null) f.el.removeAttribute('title');
      timer = window.setTimeout(() => {
        show(f.el, f.text);
        if (e.pointerType !== 'mouse') swallow = true;
      }, delay);
    };
    const over = (e: PointerEvent) => { if (e.pointerType === 'mouse') arm(e, 350); };
    const down = (e: PointerEvent) => { if (e.pointerType !== 'mouse') arm(e, 450); };
    const up = (e: PointerEvent) => { if (e.pointerType !== 'mouse') window.setTimeout(hide, 1200); };
    const click = (e: MouseEvent) => { if (swallow) { e.preventDefault(); e.stopPropagation(); swallow = false; } hide(); };
    const ctx = (e: Event) => { if (swallow) e.preventDefault(); };
    window.addEventListener('pointerover', over);
    window.addEventListener('pointerout', hide);
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', hide);
    window.addEventListener('click', click, true);
    window.addEventListener('contextmenu', ctx);
    window.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('keydown', hide);
    return () => {
      hide();
      window.removeEventListener('pointerover', over);
      window.removeEventListener('pointerout', hide);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', hide);
      window.removeEventListener('click', click, true);
      window.removeEventListener('contextmenu', ctx);
      window.removeEventListener('scroll', hide);
      window.removeEventListener('keydown', hide);
    };
  }, []);
  if (!tip) return null;
  return <div className={`tip-bubble ${tip.below ? 'is-below' : ''}`} style={{ left: tip.x, top: tip.y }} role="tooltip">{tip.text}</div>;
}
