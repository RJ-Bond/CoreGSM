import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, getToken, setToken, type Access, type Me, type UpdateInfo } from './api';
import { AuthContext } from './auth';
import { onAccentChange, paintBrand, useAutoAccent } from './accent';
import CommandPalette from './components/CommandPalette';
import NotificationBell from './components/NotificationBell';
import NotFound from './components/NotFound';
import Tour from './components/Tour';
import { ConfirmHost } from './confirm';
import Login from './pages/Login';
import Register from './pages/Register';
import Setup from './pages/Setup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import ServersPage from './pages/Servers';
import { NewsFeed } from './pages/News';
import AdminPage from './pages/Admin';
import ProfilePage from './pages/Profile';
import PublicProfilePage from './pages/PublicProfile';
import { applyServerPrefs, t, useI18n, type TKey } from './i18n';
import StatusPage from './pages/Status';
import UiKitPage from './pages/UiKit';
import { AuthCard, AuthShell, IconNews, IconServers, IconSettings, Logo, ThemeToggle, Toaster, UserAvatar, Wordmark, navigate, parseRoute, toast, useRoute } from './ui';

const IconStatus = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);

interface PageDef { id: string; label: TKey; icon: () => ReactNode; admin?: boolean }

// everybody can open the server list and the news; everything that changes the panel is in "Админка"
const PAGES: PageDef[] = [
  { id: 'servers', label: 'nav.servers', icon: IconServers },
  { id: 'news', label: 'nav.news', icon: IconNews },
  { id: 'status', label: 'nav.status', icon: IconStatus },
  { id: 'admin', label: 'nav.admin', icon: IconSettings, admin: true },
];

const ADMIN_TITLES: Record<string, string> = {
  start: 'Начало работы',
  servers: 'Серверы',
  discord: 'Discord',
  news: 'Новости',
  alerts: 'Оповещения',
  cards: 'Карточки',
  users: 'Пользователи',
  journal: 'Журнал',
  system: 'Система',
  settings: 'Настройки',
};

const DEFAULT_ACCESS: Access = { publicPanel: true, registration: true, registrationMode: 'open', rules: '', discordLogin: false, brand: { name: 'CoreGSM', color: '#4f46e5', hasLogo: false, logoV: 0 } };

/**
 * Brand colour, name and tab colour; recomputed when the theme flips.
 * Safeguards: white text on filled buttons keeps >= 4.5:1 (the fill is darkened, hue kept); brand-coloured text (--link)
 * keeps >= 4.5:1 on the card and soft surfaces of the current theme (darkened in light, lightened in dark).
 */
function useBrand(b: Access['brand']) {
  useEffect(() => {
    const root = document.documentElement;
    // paintBrand (accent.ts) applies the community colour, or the game accent chosen in «Внешний вид»
    const apply = () => paintBrand(b.color, b.color2);
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    const off = onAccentChange(apply);
    // "as in the system" theme: follow the OS switching while the page is open
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', apply);
    return () => {
      mo.disconnect();
      off();
      mq.removeEventListener?.('change', apply);
    };
  }, [b.color, b.color2]);
}

interface Boot { ready: boolean; offline: boolean; needsSetup: boolean; me: Me | null; access: Access }

const IconSearch = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

const IconLogout = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </svg>
);

export default function App() {
  const { page: rawPage, sub } = useRoute();
  // re-renders the whole shell when the language or a regional setting changes
  useI18n();
  const [boot, setBoot] = useState<Boot>({ ready: false, offline: false, needsSetup: false, me: null, access: DEFAULT_ACCESS });
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [authing, setAuthing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteRef = useRef(false);
  const shellOk = useRef(false);
  paletteRef.current = paletteOpen;
  const mainRef = useRef<HTMLElement>(null);

  // who is signed in, what is open to guests, and whether the first-run wizard is still pending
  const load = useCallback(async () => {
    const [access, setup] = await Promise.all([
      api<Access>('/access').catch(() => DEFAULT_ACCESS),
      api<{ needed: boolean }>('/setup/status').catch(() => ({ needed: false })),
    ]);
    let me: Me | null = null;
    let offline = false;
    if (getToken()) {
      try {
        me = await api<Me>('/me');
      } catch (e) {
        // only a rejected token ends the session; a network error or a 5xx must not log anyone out
        if (e instanceof ApiError && e.status === 401) setToken('');
        else offline = true;
      }
    }
    // language and regional settings of the account apply as soon as we know who is signed in
    if (me?.prefs) applyServerPrefs(me.prefs);
    setBoot((prev) => {
      if (offline) return prev.ready && prev.me ? prev : { ...prev, ready: true, offline: true };
      return { ready: true, offline: false, needsSetup: setup.needed, me, access };
    });
  }, []);

  const meRef = useRef<Me | null>(null);
  const accessRef = useRef<Access>(DEFAULT_ACCESS);
  meRef.current = boot.me;
  accessRef.current = boot.access;
  const loggingOut = useRef(false);

  useEffect(() => { void load(); }, [load]);

  // while the server is unreachable at start, try again by itself
  useEffect(() => {
    if (!boot.offline) return;
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [boot.offline, load]);

  // back from "Войти через Discord": the backend puts the new session token into the address (/auth/<jwt>).
  // The token leaves the address bar at once (no history entry), is checked with /me and only then kept.
  const pendingJwt = useRef('');
  useEffect(() => {
    if (rawPage !== 'auth' || !sub) return;
    pendingJwt.current = sub;
    setAuthing(true);
    navigate('/servers', { replace: true });
  }, [rawPage, sub]);
  useEffect(() => {
    if (!boot.ready || !authing) return;
    const jwt = pendingJwt.current;
    pendingJwt.current = '';
    if (!jwt) { setAuthing(false); return; }
    // already signed in: the link is ignored
    if (boot.me) { setAuthing(false); return; }
    void (async () => {
      let ok = false;
      try {
        ok = (await fetch('/api/me', { headers: { Authorization: `Bearer ${jwt}` } })).ok;
      } catch {
        ok = false;
      }
      if (ok) {
        setToken(jwt);
        await load();
      } else {
        toast(t('app.discordFail'), 'err');
        navigate('/login');
      }
      setAuthing(false);
    })();
  }, [boot.ready, boot.me, authing, load]);

  useEffect(() => {
    // a rejected token (expired, account removed) comes back as this event; several requests may report it at once
    let timer = 0;
    const out = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // nobody was signed in, we signed out ourselves, or a new sign-in has already happened: nothing to do
        if (!meRef.current || loggingOut.current || getToken()) return;
        toast(t('app.sessionEnded'), 'info');
        setBoot((p) => ({ ...p, me: null }));
        const { page } = parseRoute();
        const publicRoute = accessRef.current.publicPanel && (page === '' || page === 'servers' || page === 'news' || page === 'status' || page === 'u');
        if (!publicRoute) navigate('/login');
        void load();
      }, 300);
    };
    window.addEventListener('coregsm:logout', out);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('coregsm:logout', out);
    };
  }, [load]);

  const { me, access } = boot;
  const isAdmin = me?.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    const check = () => {
      if (document.hidden) return;
      api<UpdateInfo>('/update/status').then((r) => setUpdateAvailable(r.available)).catch(() => undefined);
    };
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, [isAdmin]);

  const logout = useCallback(async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    try {
      // ends the session on the server too; a failure (404, no connection) must not keep the user signed in
      await api('/sessions/current', 'DELETE');
    } catch {
      /* ignore */
    }
    setToken('');
    navigate('/servers');
    await load();
    loggingOut.current = false;
  }, [load]);

  useBrand(access.brand);
  useAutoAccent(boot.ready && !boot.offline && !boot.needsSetup, { page: rawPage, sub });

  // Ctrl/Cmd+K: the command palette (not over another dialog, not on the sign-in screens)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return;
      if (!shellOk.current) return;
      if (!paletteRef.current && document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      setPaletteOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isStaff = isAdmin || me?.role === 'moderator';
  const ctx = useMemo(() => ({ me, isAdmin: !!isAdmin, isStaff, access, reload: load, logout }), [me, isAdmin, isStaff, access, load, logout]);

  // ---- document title and focus follow the route ----
  const visible = PAGES.filter((p) => !p.admin || isStaff);
  // a public player page (/u/<name>) is open to guests even when the rest of the panel is closed
  const showAuth = !me && rawPage !== 'u' && (!access.publicPanel || rawPage === 'login' || rawPage === 'auth' || rawPage === 'register');
  shellOk.current = boot.ready && !authing && !boot.offline && !boot.needsSetup && !showAuth;
  // a first segment nobody knows (typo, old link) gets the 404 page; known-but-unavailable routes keep falling back to the list
  const notFound = rawPage !== '' && !['login', 'register', 'auth', 'profile', 'u', '_ui', 'forgot', 'reset', 'verify'].includes(rawPage) && !PAGES.some((p) => p.id === rawPage);
  const page = notFound ? '404' : rawPage === 'u' ? 'u' : rawPage === 'profile' && me ? 'profile' : rawPage === '_ui' && isAdmin ? '_ui' : visible.some((p) => p.id === rawPage) ? rawPage : 'servers';
  const adminSection = sub.split('/')[0];
  let publicName = '';
  if (page === 'u') {
    try { publicName = decodeURIComponent(sub.split('/')[0]); } catch { publicName = sub.split('/')[0]; }
  }
  const sectionTitle = boot.needsSetup
    ? t('title.setup')
    : showAuth
      ? rawPage === 'register' && access.registration ? t('auth.register') : t('auth.signIn')
      : page === '_ui'
        ? 'UI-кит'
        : page === '404'
        ? t('title.notfound')
        : page === 'u'
        ? publicName
        : page === 'profile'
        ? t('hdr.profile')
        : page === 'admin'
          ? (ADMIN_TITLES[adminSection] ? `${t('nav.admin')} · ${ADMIN_TITLES[adminSection]}` : t('nav.admin'))
          : (() => { const d = PAGES.find((p) => p.id === page); return d ? t(d.label) : ''; })();
  useEffect(() => {
    document.title = boot.ready && sectionTitle ? `${sectionTitle} · ${access.brand.name}` : access.brand.name;
  }, [boot.ready, sectionTitle, access.brand.name]);

  const routeKey = `${page}/${page === 'servers' || page === 'admin' ? adminSection : ''}`;
  const firstRoute = useRef(true);
  useEffect(() => {
    if (!boot.ready) return;
    if (firstRoute.current) { firstRoute.current = false; return; }
    window.scrollTo(0, 0);
    // a dialog (the tour, a confirmation) keeps the focus it has
    if (document.querySelector('[aria-modal="true"]')) return;
    mainRef.current?.focus({ preventScroll: true });
  }, [routeKey, boot.ready]);

  if (!boot.ready || authing) {
    return (
      <div className="grid min-h-[100dvh] place-items-center text-2xl" role="status" aria-label={t('hdr.loading')}>
        <Wordmark />
      </div>
    );
  }

  if (boot.offline) {
    return (
      <div className="grid min-h-[100dvh] place-items-center p-6">
        <div className="panel w-full max-w-sm space-y-4 p-6 text-center">
          <Wordmark className="text-2xl" />
          <p className="text-lg font-black" role="alert">{t('hdr.offlineTitle')}</p>
          <p className="font-semibold text-mute">{t('hdr.offlineText')}</p>
          <button className="btn btn-block" onClick={() => void load()}>{t('common.retry')}</button>
        </div>
        <Toaster />
      </div>
    );
  }

  if (boot.needsSetup) {
    return (
      <AuthContext.Provider value={ctx}>
        <Setup onDone={() => void load()} />
        <Toaster />
        <ConfirmHost />
      </AuthContext.Provider>
    );
  }

  // e-mail flows (forgot / reset / verify): open to everybody, also while the panel is closed or someone is signed in
  if (rawPage === 'forgot' || rawPage === 'reset' || rawPage === 'verify') {
    const token = sub.split('/')[0];
    return (
      <AuthContext.Provider value={ctx}>
        <AuthShell>
          {rawPage === 'forgot' ? <ForgotPassword /> : rawPage === 'reset' ? <ResetPassword token={token} /> : <VerifyEmail token={token} />}
        </AuthShell>
        <Toaster />
        <ConfirmHost />
      </AuthContext.Provider>
    );
  }

  // sign-in / registration screens: for a closed panel they are the only thing a guest sees
  if (showAuth) {
    const done = () => { navigate('/servers'); void load(); };
    const mode = rawPage === 'register' && access.registration ? 'register' : 'login';
    // after a failed Discord sign-in the backend sends /login/<message>
    let notice = '';
    if (rawPage === 'login' && sub) {
      try { notice = decodeURIComponent(sub); } catch { notice = sub; }
    }
    return (
      <AuthContext.Provider value={ctx}>
        <AuthShell>
          <AuthCard mode={mode}>
            {mode === 'register' ? <Register onDone={done} /> : <Login onDone={done} notice={notice} />}
          </AuthCard>
        </AuthShell>
        <Toaster />
        <ConfirmHost />
      </AuthContext.Provider>
    );
  }

  const dot = (
    <span className="update-dot ml-1.5 align-middle" title={t('hdr.update')}>
      <span className="sr-only">({t('hdr.update')})</span>
    </span>
  );

  return (
    <AuthContext.Provider value={ctx}>
      <a
        href="/servers"
        className="skip-link"
        onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}
      >
        {t('nav.skip')}
      </a>
      <div className="mx-auto min-h-full max-w-6xl px-3 pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] pt-3 sm:px-6 sm:pt-4 md:pb-16">
        <header className="glass sticky top-2 z-30 mb-5 flex items-center gap-x-2 rounded-[22px] py-2 pl-3 pr-2 sm:top-3 md:mb-7 md:gap-x-3 md:pl-4">
          <a href="/servers" className="flex min-w-0 items-center gap-2.5 text-xl font-black tracking-tight max-md:flex-1 sm:text-[22px]">
            <Logo size={34} alt="" />
            <Wordmark className="min-w-0 truncate" />
          </a>
          {/* desktop navigation; on phones the same sections live in the bottom bar */}
          <nav className="seg ml-2 hidden md:inline-flex" aria-label={t('nav.sections')}>
            {visible.map((p) => (
              <a key={p.id} href={`/${p.id}`} aria-current={page === p.id ? 'page' : undefined} className="seg-item !py-1.5">
                {t(p.label)}
                {p.id === 'admin' && updateAvailable && dot}
              </a>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 md:ml-auto">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="btn-soft hdr-search"
              aria-label={t('hdr.searchAria')}
              aria-haspopup="dialog"
              title={t('hdr.searchTitle')}
            >
              <IconSearch />
              <span className="hidden md:inline">{t('hdr.search')}</span>
              <kbd className="hidden rounded-md bg-card px-1.5 py-0.5 font-sans text-[11px] font-bold text-mute md:inline">Ctrl K</kbd>
            </button>
            {me && <NotificationBell initialUnread={me.unreadNotifications ?? 0} />}
            <ThemeToggle />
            {me ? (
              <>
                <a
                  href="/profile"
                  aria-current={page === 'profile' ? 'page' : undefined}
                  className={`flex items-center justify-center gap-2 rounded-full font-extrabold transition max-sm:h-11 max-sm:w-11 sm:max-w-[11rem] sm:py-1 sm:pl-1 sm:pr-3.5 ${page === 'profile' ? 'bg-soft text-link' : 'text-ink hover:bg-soft'}`}
                  title={t('hdr.profileOf', { name: me.username })}
                  aria-label={t('hdr.profileOf', { name: me.username })}
                >
                  <UserAvatar name={me.username} url={me.avatarUrl} size={32} tone="grad" className="!rounded-full" />
                  <span className="hidden truncate sm:inline">{me.username}</span>
                </a>
                <button
                  onClick={() => void logout()}
                  className="btn-ghost btn-sm"
                  aria-label={t('hdr.logout')}
                  title={t('hdr.logout')}
                >
                  <span className="sm:hidden"><IconLogout /></span>
                  <span className="hidden sm:inline">{t('hdr.logout')}</span>
                </button>
              </>
            ) : (
              <>
                <a href="/login" className="btn btn-soft btn-sm">{t('hdr.login')}</a>
                {access.registration && <a href="/register" className="btn btn-sm hidden sm:inline-flex">{t('hdr.register')}</a>}
              </>
            )}
          </div>
        </header>

        <main id="main-content" ref={mainRef} tabIndex={-1} key={page} className="pop min-w-0 outline-none">
          {page === 'servers' && <ServersPage sub={sub} />}
          {page === 'news' && <NewsFeed sub={sub} />}
          {page === 'status' && <StatusPage />}
          {page === 'admin' && <AdminPage sub={sub} updateAvailable={updateAvailable} />}
          {page === 'profile' && <ProfilePage />}
          {page === 'u' && <PublicProfilePage username={publicName} />}
          {page === '_ui' && <UiKitPage />}
          {page === '404' && <NotFound />}
        </main>

        <Toaster />
        <ConfirmHost />
        {isAdmin && <Tour />}
        {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} isStaff={isStaff} isAdmin={!!isAdmin} />}

        <nav
          className="glass fixed inset-x-3 z-40 mx-auto max-w-md rounded-[26px] md:hidden"
          style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
          aria-label={t('nav.sections')}
        >
          <ul className="flex px-1.5">
            {visible.map((p) => {
              const active = page === p.id;
              return (
                <li key={p.id} className="flex-1">
                  <a
                    href={`/${p.id}`}
                    aria-current={active ? 'page' : undefined}
                    className={`relative flex min-h-[58px] flex-col items-center gap-0.5 px-1 pb-1.5 pt-2 text-[11px] font-extrabold ${active ? 'text-link' : 'text-mute'}`}
                  >
                    <span className={`grid h-7 w-14 place-items-center rounded-full transition ${active ? 'bg-gradient-to-br from-brand to-brand-2 text-white shadow-pop' : ''}`}>{p.icon()}</span>
                    {t(p.label)}
                    {p.id === 'admin' && updateAvailable && (
                      <span className="update-dot absolute right-[26%] top-2"><span className="sr-only">{t('hdr.update')}</span></span>
                    )}
                  </a>
                </li>
              );
            })}
            {!me && (
              <li className="flex-1">
                <a href={access.registration ? '/register' : '/login'} className="flex min-h-[58px] flex-col items-center gap-0.5 px-1 pb-1.5 pt-2 text-[11px] font-extrabold text-link">
                  <span className="grid h-7 w-14 place-items-center rounded-full bg-soft text-lg" aria-hidden>→</span>
                  {t('hdr.login')}
                </a>
              </li>
            )}
          </ul>
        </nav>
      </div>
    </AuthContext.Provider>
  );
}
