import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken, type Access, type Me, type UpdateInfo } from './api';
import { AuthContext } from './auth';
import Login from './pages/Login';
import Register from './pages/Register';
import Setup from './pages/Setup';
import ServersPage from './pages/Servers';
import { NewsFeed } from './pages/News';
import AdminPage from './pages/Admin';
import ProfilePage from './pages/Profile';
import { AuthCard, AuthShell, IconNews, IconServers, IconSettings, Logo, ThemeToggle, Toaster, UserAvatar, Wordmark, useHash } from './ui';

interface PageDef { id: string; label: string; icon: () => ReactNode; admin?: boolean }

// everybody can open the server list and the news; everything that changes the panel is in "Админка"
const PAGES: PageDef[] = [
  { id: 'servers', label: 'Серверы', icon: IconServers },
  { id: 'news', label: 'Новости', icon: IconNews },
  { id: 'admin', label: 'Админка', icon: IconSettings, admin: true },
];

const DEFAULT_ACCESS: Access = { publicPanel: true, registration: true, registrationMode: 'open', rules: '', discordLogin: false, brand: { name: 'CoreGSM', color: '#4f46e5', hasLogo: false, logoV: 0 } };

/** brand colour, name and tab colour; recomputed when the theme flips */
function useBrand(b: Access['brand']) {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const hex = b.color.replace('#', '');
      const [r, g, bl] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const dark = root.getAttribute('data-theme') === 'dark' || (!root.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const mix = (c: number, t: number, k: number) => Math.round(c + (t - c) * k);
      const hover = [r, g, bl].map((c) => (dark ? mix(c, 255, 0.2) : mix(c, 0, 0.15))).join(' ');
      const link = [r, g, bl].map((c) => (dark ? mix(c, 255, 0.45) : c)).join(' ');
      root.style.setProperty('--brand', `${r} ${g} ${bl}`);
      root.style.setProperty('--brand-hover', hover);
      root.style.setProperty('--link', link);
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    document.title = b.name;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', b.color);
    return () => mo.disconnect();
  }, [b.color, b.name]);
}

interface Boot { ready: boolean; needsSetup: boolean; me: Me | null; access: Access }

export default function App() {
  const { page: rawPage, sub } = useHash();
  const [boot, setBoot] = useState<Boot>({ ready: false, needsSetup: false, me: null, access: DEFAULT_ACCESS });
  const [updateAvailable, setUpdateAvailable] = useState(false);

  // who is signed in, what is open to guests, and whether the first-run wizard is still pending
  const load = useCallback(async () => {
    const [access, setup] = await Promise.all([
      api<Access>('/access').catch(() => DEFAULT_ACCESS),
      api<{ needed: boolean }>('/setup/status').catch(() => ({ needed: false })),
    ]);
    let me: Me | null = null;
    if (getToken()) {
      me = await api<Me>('/me').catch(() => null);
      if (!me) setToken('');
    }
    setBoot({ ready: true, needsSetup: setup.needed, me, access });
  }, []);

  // back from "Войти через Discord": the backend puts the new session token into the address (#/auth/<jwt>)
  useEffect(() => {
    if (rawPage !== 'auth' || !sub) return;
    setToken(sub);
    window.location.hash = '#/servers';
    void load();
  }, [rawPage, sub, load]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    // a rejected token (expired, account removed) comes back as this event
    const out = () => void load();
    window.addEventListener('coregsm:logout', out);
    return () => window.removeEventListener('coregsm:logout', out);
  }, [load]);

  const { me, access } = boot;
  const isAdmin = me?.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    const check = () => api<UpdateInfo>('/update/status').then((r) => setUpdateAvailable(r.available)).catch(() => undefined);
    void check();
    const t = setInterval(check, 30 * 60_000);
    return () => clearInterval(t);
  }, [isAdmin]);

  const logout = useCallback(() => {
    setToken('');
    window.location.hash = '#/servers';
    void load();
  }, [load]);

  useBrand(access.brand);

  const ctx = useMemo(() => ({ me, isAdmin: !!isAdmin, access, reload: load, logout }), [me, isAdmin, access, load, logout]);

  if (!boot.ready) return <div className="grid min-h-full place-items-center text-2xl"><Wordmark /></div>;

  if (boot.needsSetup) {
    return (
      <AuthContext.Provider value={ctx}>
        <Setup onDone={() => void load()} />
        <Toaster />
      </AuthContext.Provider>
    );
  }

  // sign-in / registration screens: for a closed panel they are the only thing a guest sees
  const wantsRegister = rawPage === 'register';
  if (!me && (!access.publicPanel || rawPage === 'login' || rawPage === 'auth' || wantsRegister)) {
    const done = () => { window.location.hash = '#/servers'; void load(); };
    const mode = wantsRegister && access.registration ? 'register' : 'login';
    // after a failed Discord sign-in the backend sends #/login/<message>
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
      </AuthContext.Provider>
    );
  }

  const visible = PAGES.filter((p) => !p.admin || isAdmin);
  const page = rawPage === 'profile' && me ? 'profile' : visible.some((p) => p.id === rawPage) ? rawPage : 'servers';
  const dot = <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-warn align-middle" title="Доступно обновление" />;

  return (
    <AuthContext.Provider value={ctx}>
      <div className="mx-auto min-h-full max-w-6xl px-4 pb-28 pt-5 sm:px-6 md:pb-16">
        <header className="mb-6 flex items-center gap-x-4 md:mb-8">
          <a href="#/servers" className="flex items-center gap-2.5 text-2xl font-black tracking-tight">
            <Logo size={34} />
            <Wordmark />
          </a>
          {/* desktop navigation; on phones the same sections live in the bottom bar */}
          <nav className="hidden gap-1.5 md:flex" aria-label="Разделы">
            {visible.map((p) => (
              <a
                key={p.id}
                href={`#/${p.id}`}
                aria-current={page === p.id ? 'page' : undefined}
                className={`whitespace-nowrap rounded-full px-4 py-1.5 font-extrabold transition ${
                  page === p.id ? 'bg-brand text-white shadow-pop' : 'bg-card text-ink shadow-pop hover:text-link'
                }`}
              >
                {p.label}
                {p.id === 'admin' && updateAvailable && dot}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {me ? (
              <>
                <a
                  href="#/profile"
                  aria-current={page === 'profile' ? 'page' : undefined}
                  className={`flex max-w-[11rem] items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 font-extrabold shadow-pop transition ${page === 'profile' ? 'bg-brand text-white' : 'bg-card text-ink hover:text-link'}`}
                  title="Профиль"
                >
                  <UserAvatar name={me.username} url={me.avatarUrl} size={28} className="!rounded-full" />
                  <span className="hidden truncate sm:inline">{me.username}</span>
                </a>
                <button onClick={logout} className="rounded-full bg-card px-4 py-2 font-extrabold text-mute shadow-pop hover:text-bad">Выйти</button>
              </>
            ) : (
              <>
                <a href="#/login" className="rounded-full bg-card px-4 py-2 font-extrabold text-ink shadow-pop hover:text-link">Войти</a>
                {access.registration && <a href="#/register" className="btn hidden sm:inline-flex">Регистрация</a>}
              </>
            )}
          </div>
        </header>

        <main key={page} className="pop min-w-0">
          {page === 'servers' && <ServersPage sub={sub} />}
          {page === 'news' && <NewsFeed />}
          {page === 'admin' && <AdminPage sub={sub} updateAvailable={updateAvailable} />}
          {page === 'profile' && <ProfilePage />}
        </main>

        <Toaster />

        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 backdrop-blur md:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          aria-label="Разделы"
        >
          <ul className="mx-auto flex max-w-md">
            {visible.map((p) => {
              const active = page === p.id;
              return (
                <li key={p.id} className="flex-1">
                  <a
                    href={`#/${p.id}`}
                    aria-current={active ? 'page' : undefined}
                    className={`relative flex flex-col items-center gap-0.5 px-1 pb-2 pt-2.5 text-xs font-extrabold ${active ? 'text-link' : 'text-mute'}`}
                  >
                    <span className={`grid h-8 w-14 place-items-center rounded-full transition ${active ? 'bg-soft' : ''}`}>{p.icon()}</span>
                    {p.label}
                    {p.id === 'admin' && updateAvailable && <span className="absolute right-[26%] top-2 h-2.5 w-2.5 rounded-full bg-warn" />}
                  </a>
                </li>
              );
            })}
            {!me && (
              <li className="flex-1">
                <a href={access.registration ? '#/register' : '#/login'} className="flex flex-col items-center gap-0.5 px-1 pb-2 pt-2.5 text-xs font-extrabold text-link">
                  <span className="grid h-8 w-14 place-items-center rounded-full bg-soft text-lg">→</span>
                  Войти
                </a>
              </li>
            )}
          </ul>
        </nav>
      </div>
    </AuthContext.Provider>
  );
}
