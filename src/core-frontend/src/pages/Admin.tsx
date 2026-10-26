import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, type Binding, type CertInfo, type Server, type ServerInput, type StatusInfo, type UpdateInfo, type UserRow } from '../api';
import { useAuth } from '../auth';
import { t, useI18n } from '../i18n';
import type { MaintenanceWindow } from '../maintenance';
import { gameLabel } from '../games';
import { AdminPage as PageStack, Empty, ErrorLine, GameAvatar, IconArrowUp, LoadError, IconClose, IconEdit, IconRefresh, IconServers, IconTrash, PageHead, StatusPill, ago, toast, undoable, usePoll, navigate, fail } from '../ui';
import { ADMIN_GROUPS, ADMIN_SECTIONS, OVERVIEW_SECTION, SECTION_PERM, START_SECTION, type AdminSection } from './adminNav';
import { PINS_KEY, PINS_MAX, movePin, readIds, togglePin, writeIds } from './adminShortcuts';
import AdminMobileNav, { type MobileNavGroup } from './AdminMobileNav';
import AdminOverview from './AdminOverview';
import AdminStatusBar from '../components/AdminStatusBar';
import { CHORDS, chordOf } from './adminLogic';
import { ServersArt } from '../components/Illustrations';
import AdminStart, { AdminHome } from './AdminStart';
import AdminCommunity from './AdminCommunity';
import AlertsPage from './Alerts';
import CardsPage from './Cards';
import DiscordPage from './Discord';
import NewsPage from './News';
import ServerForm, { emptyServer } from './ServerForm';
import { AdminServersTable } from './AdminServersTable';
import { moveId } from './adminServersLogic';
import { SetupProgress } from './AdminStart';
import JournalPage from './Journal';
import MaintenancePage from './Maintenance';
import SettingsPage, { UsersTab } from './Settings';

export { ADMIN_SECTIONS };
import HealthPage from './Health';
import SystemPage from './System';

/** n = 0 draws a bare dot (a state, not a count) */
interface NavBadge { n: number; tone: 'bad' | 'warn'; label: string }

/** the small counters on the sidebar: servers that do not answer, people waiting for approval */
function useNavBadges(isAdmin: boolean, perms: string[]): Record<string, NavBadge> {
  const [b, setB] = useState<Record<string, NavBadge>>({});
  usePoll(async () => {
    const out: Record<string, NavBadge> = {};
    if (isAdmin || perms.includes('servers')) {
      const list = await api<Server[]>('/servers').catch(() => null);
      const down = list ? list.filter((s) => !s.online && s.hasStatus && !s.maintenance).length : 0;
      if (down > 0) out.servers = { n: down, tone: 'bad', label: t('adm.badge.problems', { k: down }) };
    }
    if (isAdmin || perms.includes('moderation')) {
      const [rep, com] = await Promise.all([api<{ open: number }>('/reports/count').catch(() => null), api<{ open: number }>('/news/comments/count').catch(() => null)]);
      const n = (rep?.open ?? 0) + (com?.open ?? 0);
      if (n > 0) out.community = { n, tone: 'warn', label: `Ждут модерации: жалоб на игроков ${rep?.open ?? 0}, комментариев ${com?.open ?? 0}` };
    }
    if (isAdmin) {
      const [bot, sys] = await Promise.all([
        api<{ state?: string }>('/bot/status').catch(() => null),
        api<{ cert?: { daysLeft: number | null } }>('/system').catch(() => null),
      ]);
      if (bot?.state === 'error') out.discord = { n: 0, tone: 'bad', label: 'Бот Discord в ошибке' };
      const days = sys?.cert?.daysLeft;
      if (days != null && days <= 14) out.system = { n: 0, tone: days <= 0 ? 'bad' : 'warn', label: days <= 0 ? 'Сертификат истёк' : `Сертификат истекает через ${days} дн.` };
      const users = await api<UserRow[]>('/users').catch(() => null);
      const wait = users ? users.filter((u) => u.status === 'pending').length : 0;
      if (wait > 0) out.users = { n: wait, tone: 'warn', label: t('adm.badge.pending', { k: wait }) };
    }
    setB(out);
  }, 30_000);
  return b;
}

/** The administrator's area: everything that changes the panel lives here. */
export default function AdminPage({ sub, updateAvailable }: { sub: string; updateAvailable: boolean }) {
  useI18n();
  const { isAdmin, me } = useAuth();
  const [section, ...rest] = sub.split('/');
  // a moderator sees the sections of the permissions the administrator gave; everything else is for administrators
  const sections = isAdmin ? ADMIN_SECTIONS : ADMIN_SECTIONS.filter((s) => SECTION_PERM[s.id] && (me?.perms ?? []).includes(SECTION_PERM[s.id]!));
  const known = sections.some((s) => s.id === section);
  // bare /admin (or an unknown section): administrators land on «Начало работы» or «Серверы», see AdminHome
  const home = isAdmin && !known;
  const current = known ? section : sections[0].id;
  // the sub-path belongs to the section that was asked for, not to the fallback
  const tail = current === section ? rest.join('/') : '';
  // «Недавние» (the last visited sections) and «Закреплённые» (stars): this browser only
  const validIds = useMemo(() => ADMIN_SECTIONS.map((x) => x.id), []);
  const [pins, setPins] = useState<string[]>(() => readIds(PINS_KEY, validIds, PINS_MAX));
  // (the «Недавние» block is gone from the menu: it repeated sections that are already listed in the groups)
  const pin = (s: AdminSection) => {
    const r = togglePin(pins, s.id);
    if (r.full) { toast(t('adm.pinMax',{n:PINS_MAX}), 'info'); return; }
    setPins(r.pins);
    writeIds(PINS_KEY, r.pins);
  };
  const badges = useNavBadges(isAdmin, me?.perms ?? []);
  const [dense, setDense] = useState(() => { try { return localStorage.getItem('coregsm_admin_density') === 'compact'; } catch { return false; } });
  // the menu can shrink to a column of icons: more room for the page itself
  const [rail, setRail] = useState(() => { try { return localStorage.getItem('coregsm_admin_rail') === '1'; } catch { return false; } });
  const flipRail = () => setRail((v) => { try { localStorage.setItem('coregsm_admin_rail', v ? '0' : '1'); } catch { /* not remembered */ } return !v; });
  const flipDense = () => setDense((v) => { try { localStorage.setItem('coregsm_admin_density', v ? 'cozy' : 'compact'); } catch { /* not remembered */ } return !v; });
  // pinned sections can be dragged (or moved with Alt+↑/↓) to change their order
  const dragId = useRef<string | null>(null);
  const reorder = (id: string, to: number) => {
    const n = movePin(pins, id, to);
    setPins(n);
    writeIds(PINS_KEY, n);
  };
  const byId = (id: string) => ADMIN_SECTIONS.find((x) => x.id === id);
  const pinned = pins.map(byId).filter((x): x is AdminSection => !!x);

  /** a link, and (for admins) the star that pins it: a sibling button, never a button inside the link */
  const item = (s: AdminSection, scope = '') => {
    const on = pins.includes(s.id);
    return (
      <div
        key={`${scope}${s.id}`}
        className="adm-item"
        data-current={current === s.id ? 'true' : undefined}
        data-pinned={on ? 'true' : undefined}
        draggable={scope === 'p-' || undefined}
        title={scope === 'p-' ? t('adm.pinMove') : undefined}
        onDragStart={scope === 'p-' ? (e) => { dragId.current = s.id; e.dataTransfer.effectAllowed = 'move'; } : undefined}
        onDragOver={scope === 'p-' ? (e) => { if (dragId.current) e.preventDefault(); } : undefined}
        onDrop={scope === 'p-' ? (e) => { e.preventDefault(); if (dragId.current && dragId.current !== s.id) reorder(dragId.current, pins.indexOf(s.id)); dragId.current = null; } : undefined}
        onDragEnd={scope === 'p-' ? () => { dragId.current = null; } : undefined}
        onKeyDown={scope === 'p-' ? (e) => {
          if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
          e.preventDefault();
          reorder(s.id, pins.indexOf(s.id) + (e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1));
        } : undefined}
      >
        {link(s, true)}
        <button
          type="button"
          className="adm-pin"
          aria-pressed={on}
          aria-label={`${on ? t('adm.unpin') : t('adm.pin')}: ${s.label}`}
          title={on ? t('adm.unpin') : t('adm.pinTop')}
          onClick={() => pin(s)}
        >
          <span aria-hidden>{on ? '★' : '☆'}</span>
        </button>
      </div>
    );
  };
  const link = (s: AdminSection, pinnable = false) => (
    <a
      key={s.id}
      href={`/admin/${s.id}`}
      aria-current={current === s.id ? 'page' : undefined}
      title={rail ? s.label : undefined}
      className={`adm-link flex min-w-0 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-ui-md py-1.5 pl-1.5 pr-3.5 text-sm font-bold transition max-md:rounded-full ${pinnable ? 'md:w-full md:pr-9' : ''} ${current === s.id ? 'is-on bg-linear-to-br from-brand to-brand-2 text-white shadow-pop' : 'text-mute hover:bg-soft hover:text-ink'}`}
    >
      <span className="adm-ic" aria-hidden>{s.icon()}</span>
      <span className="adm-lbl min-w-0 truncate">{s.label}</span>
      {badges[s.id] && (badges[s.id].n === 0
        ? <span className={`adm-dot is-${badges[s.id].tone}`} title={badges[s.id].label} role="img" aria-label={badges[s.id].label} />
        : <span className={`adm-badge is-${badges[s.id].tone}`} title={badges[s.id].label} aria-label={badges[s.id].label}>{badges[s.id].n}</span>)}
      {s.id === 'settings' && updateAvailable && <span className="update-dot ml-auto" title={t('adm.updAvail')} />}
    </a>
  );
  // the sliding indicator under the current link
  const navRef = useRef<HTMLElement>(null);
  const [ind, setInd] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const measure = (center = true) => {
      const nav = navRef.current;
      const el = nav?.querySelector<HTMLElement>('.adm-link[aria-current="page"]');
      if (!nav || !el || home) { setInd(null); return; }
      // measured against the nav itself: a link inside a positioned wrapper (.adm-item) has an offsetLeft of its own wrapper
      const nb = nav.getBoundingClientRect();
      const eb = el.getBoundingClientRect();
      const x = eb.left - nb.left + nav.scrollLeft - nav.clientLeft;
      const y = eb.top - nb.top + nav.scrollTop - nav.clientTop;
      setInd({ x, y, w: eb.width, h: eb.height });
      // a phone shows the sections as a row that scrolls: keep the current one in the middle of it
      if (center && nav.scrollWidth > nav.clientWidth + 2 && nav.scrollHeight <= nav.clientHeight + 2) nav.scrollTo({ left: Math.max(0, x - (nav.clientWidth - eb.width) / 2), behavior: 'auto' });
    };
    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    // the links change width after the first measure (the font arrives, a badge appears): the pill and the scroll follow
    let alive = true;
    void document.fonts?.ready.then(() => { if (alive) measure(); });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure(false));
    navRef.current?.querySelectorAll('.adm-link').forEach((l) => ro?.observe(l));
    return () => { alive = false; ro?.disconnect(); window.removeEventListener('resize', onResize); };
  }, [current, home, pins, badges, isAdmin, rail]);
  // «g» then a letter: go to a section (not while typing)
  useEffect(() => {
    if (!isAdmin) return;
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'g') { armed = Date.now(); return; }
      if (armed && Date.now() - armed < 1200 && CHORDS[e.key]) { armed = 0; navigate(`/admin/${CHORDS[e.key]}`); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isAdmin]);
  const [menu, setMenu] = useState(false);
  const first = tail.split('/')[0];
  const crumb = !['servers', 'discord', 'news'].includes(current) || !first ? '' : first === 'new' ? t('adm.crumb.new') : /^\d+$/.test(first) ? t('adm.crumb.edit') : '';
  const divider = <span aria-hidden className="mx-1 w-px shrink-0 self-stretch bg-line md:hidden" />;

  // a phone: one button with the current section instead of the sideways strip
  const mobileGroups: MobileNavGroup[] = isAdmin
    ? [{ key: 'top', sections: [START_SECTION, OVERVIEW_SECTION] }, ...ADMIN_GROUPS.map((g, i) => ({ key: `g${i}`, title: g.title, sections: g.sections }))]
    : [{ key: 'all', sections }];

  return (
    <div className={`grid gap-4 ${rail ? 'md:grid-cols-[4.25rem_minmax(0,1fr)]' : 'md:grid-cols-[14rem_minmax(0,1fr)]'}`} data-density={dense ? 'compact' : undefined}>
      <AdminMobileNav groups={mobileGroups} current={home ? '' : current} badges={badges} fallbackLabel={t('nav.admin')} />
      <nav ref={navRef} className={`adm-nav ${rail ? 'adm-rail' : ''} ${ind ? 'has-ind' : ''} tile fade-x fade-x-m flex max-md:hidden items-stretch gap-1 overflow-x-auto p-1.5 md:sticky md:top-24 md:max-h-[calc(100dvh-7rem)] md:flex-col md:items-stretch md:self-start md:overflow-y-auto md:p-2.5`} aria-label={t('adm.navLabel')}>
        {ind && <span className="adm-ind" aria-hidden style={{ transform: `translate(${ind.x}px, ${ind.y}px)`, width: ind.w, height: ind.h }} />}
        {isAdmin ? (
          <>
            <button type="button" className="adm-find max-md:hidden" onClick={() => window.dispatchEvent(new Event('coregsm:palette'))}>
              <span aria-hidden>⌕</span>
              <span className="min-w-0 flex-1 truncate text-left">{t('adm.nav.search')}</span>
              <kbd>Ctrl K</kbd>
            </button>
            {link(START_SECTION)}
            {link(OVERVIEW_SECTION)}
            <SetupProgress />
            {pinned.length > 0 && (
              <div className="contents md:block">
                {divider}
                <div id="adm-g-pins" className="adm-group-title hidden md:block">{t('adm.pinned')}</div>
                <div role="group" aria-labelledby="adm-g-pins" aria-label={t('adm.pinned')} className="flex gap-1 md:flex-col">
                  {pinned.map((s) => item(s, 'p-'))}
                </div>
              </div>
            )}
            {ADMIN_GROUPS.map((g, gi) => (
              <div key={g.title} className="contents md:block">
                {divider}
                <div id={`adm-g-${gi}`} className="adm-group-title hidden md:block">{g.title}</div>
                <div role="group" aria-labelledby={`adm-g-${gi}`} className="flex gap-1 md:flex-col">
                  {g.sections.map((s) => item(s))}
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="hidden px-3 pb-1 pt-1.5 text-xs font-extrabold uppercase tracking-widest text-mute md:block">{t('nav.admin')}</div>
            {sections.map((s) => link(s))}
          </>
        )}
        <button type="button" className="adm-density max-md:hidden" aria-pressed={dense} onClick={flipDense}>
          <span aria-hidden>{dense ? '▤' : '▦'}</span><span className="adm-lbl">{t('adm.density')}</span>
        </button>
        <button type="button" className="adm-density max-md:hidden" aria-pressed={rail} onClick={flipRail} title={rail ? t('adm.rail.open') : t('adm.rail.close')}>
          <span aria-hidden>{rail ? '»' : '«'}</span><span className="adm-lbl">{t('adm.rail.close')}</span>
        </button>
      </nav>
      <div className="min-w-0 space-y-5">
        {isAdmin && (
          <div className="space-y-2 empty:hidden">
            {updateAvailable && current !== 'settings' && <UpdateBanner />}
            <CertWarning />
          </div>
        )}
        {!home && isAdmin && <AdminStatusBar />}
        {!home && current !== 'start' && current !== 'overview' && (
          <nav className="adm-crumbs" aria-label={t('adm.crumb.aria')}>
            <a href="/admin/overview">Админка</a>
            <span aria-hidden>›</span>
            <span className="adm-crumb-menu">
              <button type="button" className="font-extrabold text-ink hover:text-link" aria-expanded={menu} onClick={() => setMenu((v) => !v)} onBlur={(e) => { if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) setMenu(false); }}>
                {byId(current)?.label} <span aria-hidden>▾</span>
              </button>
              {menu && (
                <div className="adm-crumb-pop" role="menu">
                  {sections.map((s) => (
                    <a key={s.id} role="menuitem" href={`/admin/${s.id}`} onClick={() => setMenu(false)}>
                      <span className="adm-ic" aria-hidden>{s.icon()}</span>{s.label}{isAdmin && chordOf(s.id) && <kbd>g {chordOf(s.id)}</kbd>}
                    </a>
                  ))}
                </div>
              )}
            </span>
            {crumb && <><span aria-hidden>›</span><span aria-current="page">{crumb}</span></>}
          </nav>
        )}
        {home && <AdminHome />}
        {!home && current === 'overview' && <AdminOverview />}
        {!home && current === 'start' && <AdminStart />}
        {!home && current === 'servers' && <ServersManage sub={tail} />}
        {!home && current === 'discord' && <DiscordPage sub={tail} />}
        {!home && current === 'news' && <NewsPage sub={tail} />}
        {!home && current === 'alerts' && <AlertsPage />}
        {!home && current === 'maintenance' && <MaintenancePage />}
        {!home && current === 'cards' && <CardsPage />}
        {!home && current === 'community' && <AdminCommunity sub={tail} />}
        {!home && current === 'users' && <UsersTab />}
        {!home && current === 'journal' && <JournalPage />}
        {!home && current === 'health' && <HealthPage />}
        {!home && current === 'system' && <SystemPage />}
        {!home && current === 'settings' && <SettingsPage sub={tail} updateAvailable={updateAvailable} />}
      </div>
    </div>
  );
}

/** A banner at the top of the admin area while a new version is waiting; it follows the running update. */
function UpdateBanner() {
  useI18n();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [offline, setOffline] = useState(false);
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem('coregsm_update_banner_hidden') === '1'; } catch { return false; } });
  const wasRunning = useRef(false);
  usePoll(
    () =>
      api<UpdateInfo>("/update/status")
        .then((r) => {
          setOffline(false);
          setInfo(r);
          if (r.job?.state === "running") wasRunning.current = true;
          // the update finished while this banner was on screen: the new frontend is served now
          if (wasRunning.current && r.job?.state === "done") {
            wasRunning.current = false;
            setTimeout(() => window.location.reload(), 1500);
          }
        })
        .catch(() => { if (wasRunning.current) setOffline(true); }),
    info?.job?.state === "running" || offline ? 2_000 : 20_000,
  );
  const running = info?.job?.state === "running" || offline;
  const failed = info?.job?.state === "error" && info.available;
  // nothing to install any more (or the status is not known yet): no banner
  if (!running && info && !info.available) return null;
  if (hidden && !running && !failed) return null;
  const pct = typeof info?.job?.progress === "number" ? Math.max(0, Math.min(100, Math.round(info.job.progress))) : null;
  const latest = info?.latest ?? null;
  return (
    <div className="update-hero relative flex flex-wrap items-center gap-x-4 gap-y-2 overflow-hidden rounded-ui-xl px-5 py-3.5 text-white" role="status">
      <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/15" />
      <span aria-hidden className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/20">
        {running ? <IconRefresh spinning /> : <IconArrowUp className="update-bob" />}
      </span>
      <div className="relative min-w-0 flex-1">
        {running ? (
          <>
            <div className="font-extrabold leading-tight">{offline ? t('adm.upd.restarting') : t('adm.upd.running')}{pct != null && !offline ? ` · ${pct}%` : ""}</div>
            <div className="text-sm font-semibold text-white/90">{offline ? t('adm.upd.takes') : info?.job?.message || t('adm.upd.installing')}</div>
            {pct != null && !offline && <div className="update-progress det mt-1.5" style={{ ["--p" as string]: `${pct}%` }}><i /></div>}
          </>
        ) : failed ? (
          <>
            <div className="font-extrabold leading-tight">{t('adm.upd.failed')}</div>
            <div className="text-sm font-semibold text-white/90">{info?.job?.message || t('adm.upd.failedHint')}</div>
          </>
        ) : (
          <>
            <div className="font-extrabold leading-tight">{t('adm.upd.available')}</div>
            <div className="text-sm font-semibold text-white/90">{t('adm.upd.build')} {latest ? <span className="font-mono">{latest.slice(0, 7)}</span> : ""} {t('adm.upd.ready')}</div>
          </>
        )}
      </div>
      <a href="/admin/settings/updates" className="btn-on-grad btn-sm relative">{running ? t('adm.more') : failed ? t('adm.open') : t('adm.update')}</a>
      {!running && !failed && (
        <button type="button" className="btn-icon-ghost btn-icon-sm relative text-white" aria-label={t('adm.stack.hide')} title={t('adm.stack.hide')} onClick={() => { try { sessionStorage.setItem('coregsm_update_banner_hidden', '1'); } catch { /* not remembered */ } setHidden(true); }}>
          <IconClose size={14} />
        </button>
      )}
    </div>
  );
}

const CERT_DISMISSED = 'coregsm_cert_warning_dismissed';
const certDismissed = () => {
  try { return sessionStorage.getItem(CERT_DISMISSED) === '1'; } catch { return false; }
};

/** A slim banner for administrators when the HTTPS certificate is about to expire (or already has). */
function CertWarning() {
  useI18n();
  const [cert, setCert] = useState<CertInfo | null>(null);
  const [hidden, setHidden] = useState(certDismissed);

  useEffect(() => {
    if (hidden) return;
    api<{ cert?: CertInfo }>('/system').then((r) => setCert(r.cert ?? null)).catch(() => undefined);
  }, [hidden]);

  if (hidden || !cert || cert.daysLeft == null || cert.daysLeft > 14) return null;
  const d = cert.daysLeft;
  const expired = d <= 0;
  const text = expired
    ? t('adm.cert.expired')
    : t('adm.cert.soon', { n: d });
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-2.5 text-sm font-bold ${expired ? 'bg-badbg text-bad' : 'bg-warnbg text-warn'}`} role={expired ? 'alert' : 'status'}>
      <span className="min-w-0 flex-1">{text} <a href="/admin/system" className="underline">{t('adm.more')}</a></span>
      <button
        type="button"
        className="btn-icon-ghost btn-icon-sm btn-tone"
        aria-label={t('adm.cert.hide')}
        onClick={() => { try { sessionStorage.setItem(CERT_DISMISSED, '1'); } catch { /* not remembered */ } setHidden(true); }}
      >
        <IconClose size={14} />
      </button>
    </div>
  );
}

/** Add, edit, delete and re-query servers. */
function ServersManage({ sub }: { sub: string }) {
  useI18n();
  const { isAdmin } = useAuth();
  const [servers, setServers] = useState<Server[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<{ id?: number; data: ServerInput; cover?: string | null } | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  // removed servers are hidden at once and really deleted after the 6 s in which «Отменить» works
  const [hidden, setHidden] = useState<number[]>([]);
  const [bindings, setBindings] = useState<Map<number, number>>(new Map());
  const [windows, setWindows] = useState<MaintenanceWindow[]>([]);
  usePoll(
    () => Promise.allSettled([api<Binding[]>('/bindings'), api<MaintenanceWindow[]>('/maintenance')]).then(([b, w]) => {
      if (b.status === 'fulfilled') {
        const m = new Map<number, number>();
        for (const x of b.value) for (const id of x.serverIds?.length ? x.serverIds : [x.serverId]) m.set(id, (m.get(id) ?? 0) + 1);
        setBindings(m);
      }
      if (w.status === 'fulfilled') setWindows(w.value);
    }),
    30_000,
  );
  // 30-day availability of every server (the public status endpoint); a column stays «–» without it
  const [uptime, setUptime] = useState<Map<number, number>>(new Map());
  usePoll(
    () => api<StatusInfo>('/status').then((r) => setUptime(new Map(r.servers.filter((x) => x.uptime30 != null).map((x) => [x.id, x.uptime30 as number])))).catch(() => undefined),
    5 * 60_000,
  );

  const load = () =>
    api<Server[]>('/servers')
      .then((s) => { setServers(s); setError(''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  usePoll(load, 15_000);

  // /admin/servers/new opens the «add» form (links from the start page and Ctrl+K)
  const openedFor = useRef('');
  useEffect(() => {
    if (sub === 'new' && openedFor.current !== sub) {
      openedFor.current = sub;
      setEditing({ data: emptyServer });
    }
    if (sub !== 'new') openedFor.current = '';
  }, [sub]);
  const closeForm = () => {
    setEditing(null);
    if (sub === 'new') navigate('/admin/servers');
  };

  const removeSome = (list: Server[], text: string) => {
    const ids = list.map((x) => x.id);
    setHidden((h) => [...h, ...ids]);
    undoable({
      text,
      restore: () => setHidden((h) => h.filter((x) => !ids.includes(x))),
      commit: async () => {
        const res = await Promise.allSettled(ids.map((id) => api(`/servers/${id}`, 'DELETE')));
        const failed = res.filter((r) => r.status === 'rejected').length;
        if (failed) toast(t('adm.srv.delPartial', { ok: ids.length - failed, bad: failed }), 'err');
        setHidden((h) => h.filter((x) => !ids.includes(x)));
        await load();
      },
    });
  };
  const remove = (s: Server) => removeSome([s], t('adm.srv.deleted'));
  // a one-hour window for this server, or the end of the one that is running
  const toggleMaintenance = async (s: Server) => {
    try {
      if (s.maintenance) {
        const w = windows.find((x) => x.serverId === s.id && x.active);
        if (!w) { toast(t('adm.tbl.maintGlobal'), 'info'); return; }
        await api(`/maintenance/${w.id}`, 'DELETE');
        toast(t('adm.tbl.maintEnded'));
      } else {
        const now = Date.now();
        await api('/maintenance', 'POST', { serverId: s.id, name: t('adm.tbl.maintName'), startTs: now, endTs: now + 3_600_000, repeat: 'none' });
        toast(t('adm.tbl.maintStarted'));
      }
    } catch (e) {
      fail(e);
    }
    await load();
    api<MaintenanceWindow[]>('/maintenance').then(setWindows).catch(() => undefined);
  };
  const refreshMany = async (list: Server[]) => {
    await Promise.allSettled(list.map((s) => api(`/servers/${s.id}/refresh`, 'POST')));
    toast(t('adm.srv.polled', { n: list.length }));
    await load();
  };
  const removeMany = async (list: Server[]) => {
    removeSome(list, t('adm.srv.delMany', { n: list.length }));
  };
  const move = async (s: Server, dir: -1 | 1, shown: number[]) => {
    const next = moveId(servers.map((x) => x.id), shown, s.id, dir);
    if (!next) return;
    try {
      await api('/servers/order', 'PUT', { ids: next });
      toast(t('adm.tbl.moved'));
    } catch (e) {
      fail(e);
    }
    await load();
  };
  const refresh = async (s: Server) => {
    setBusyId(s.id);
    await api(`/servers/${s.id}/refresh`, 'POST').catch((e: Error) => setError(e.message));
    await load();
    setBusyId(null);
  };

  return (
    <PageStack
      head={(
        <PageHead
          title={t('adm.s.servers')}
          subtitle={t('adm.srv.subtitle')}
          icon={<IconServers />}
          hint={t('adm.srv.hint')}
          help={<p>{t('adm.srv.help')}</p>}
        >
          <button className="btn" data-magnetic data-tour="add-server" onClick={() => setEditing({ data: emptyServer })}>{t('adm.srv.add')}</button>
        </PageHead>
      )}
    >
      {error && servers.length === 0 ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}

      {!loaded && (
        <div className="space-y-3" aria-busy="true" aria-label={t('adm.loading')}>
          {[0, 1, 2].map((i) => <div key={i} className="skeleton tile h-[74px]" />)}
        </div>
      )}

      {loaded && !error && servers.length === 0 && (
        <Empty art={<ServersArt />} title={t('adm.srv.emptyTitle')} text={t('adm.srv.emptyText')}>
          <button className="btn mt-3" onClick={() => setEditing({ data: emptyServer })}>{t('adm.srv.add')}</button>
        </Empty>
      )}

      {servers.length > 0 && (
        <div className="fade-in">
          <AdminServersTable
            servers={servers.filter((x) => !hidden.includes(x.id))}
            a={{
              isAdmin,
              busyId,
              uptime,
              bindings,
              onMaintenance: (sv) => void toggleMaintenance(sv),
              onRefresh: (sv) => void refresh(sv),
              onEdit: (sv) => setEditing({ id: sv.id, data: { name: sv.customName, game: sv.game, host: sv.host, port: sv.port, queryPort: sv.queryPort, displayAddress: sv.displayAddress, country: sv.country }, cover: sv.coverUrl }),
              onRemove: (sv) => void remove(sv),
              onRefreshMany: refreshMany,
              onRemoveMany: removeMany,
              onMove: (sv, dir, shown) => void move(sv, dir, shown),
            }}
          />
        </div>
      )}

      {editing && (
        <ServerForm
          initial={editing.data}
          id={editing.id}
          coverUrl={editing.cover}
          onCoverChanged={() => void load()}
          onClose={closeForm}
          onSaved={() => { closeForm(); toast(t('adm.srv.saved')); void load(); }}
        />
      )}
    </PageStack>
  );
}
