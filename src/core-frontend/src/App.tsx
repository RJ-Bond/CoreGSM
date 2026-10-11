import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken, type UpdateInfo } from './api';
import Login from './pages/Login';
import Setup from './pages/Setup';
import ServersPage from './pages/Servers';
import CardsPage from './pages/Cards';
import DiscordPage from './pages/Discord';
import SettingsPage from './pages/Settings';
import { IconCards, IconDiscord, IconServers, IconSettings, Logo, ThemeToggle, Wordmark, useHash } from './ui';

const PAGES: { id: string; label: string; icon: () => ReactNode }[] = [
  { id: 'servers', label: 'Серверы', icon: IconServers },
  { id: 'cards', label: 'Карточки', icon: IconCards },
  { id: 'discord', label: 'Discord', icon: IconDiscord },
  { id: 'settings', label: 'Настройки', icon: IconSettings },
];

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const { page: rawPage, sub } = useHash();
  const page = PAGES.some((p) => p.id === rawPage) ? rawPage : 'servers';
  // null = still checking whether the first-run wizard is needed
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(getToken() ? false : null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (authed) return;
    api<{ needed: boolean }>('/setup/status')
      .then((r) => setNeedsSetup(r.needed))
      .catch(() => setNeedsSetup(false));
  }, [authed]);

  // a dot on "Настройки" when a newer version is published in the repository
  useEffect(() => {
    if (!authed) return;
    const check = () => api<UpdateInfo>('/update/status').then((r) => setUpdateAvailable(r.available)).catch(() => undefined);
    void check();
    const t = setInterval(check, 30 * 60_000);
    return () => clearInterval(t);
  }, [authed]);

  useEffect(() => {
    const out = () => setAuthed(false);
    window.addEventListener('coregsm:logout', out);
    return () => window.removeEventListener('coregsm:logout', out);
  }, []);

  const logout = useCallback(() => {
    setToken('');
    setAuthed(false);
  }, []);

  if (!authed) {
    if (needsSetup === null) return <div className="grid min-h-full place-items-center text-2xl"><Wordmark /></div>;
    if (needsSetup) return <Setup onDone={() => { setNeedsSetup(false); setAuthed(true); }} />;
    return <Login onDone={() => setAuthed(true)} />;
  }

  const dot = <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-warn align-middle" title="Доступно обновление" />;

  return (
    <div className="mx-auto min-h-full max-w-6xl px-4 pb-28 pt-5 sm:px-6 md:pb-16">
      <header className="mb-6 flex items-center gap-x-4 md:mb-8">
        <a href="#/servers" className="flex items-center gap-2.5 text-2xl font-black tracking-tight text-link">
          <Logo size={34} />
          <Wordmark />
        </a>
        {/* desktop navigation; on phones the same sections live in the bottom bar */}
        <nav className="hidden gap-1.5 md:flex" aria-label="Разделы">
          {PAGES.map((p) => (
            <a
              key={p.id}
              href={`#/${p.id}`}
              aria-current={page === p.id ? 'page' : undefined}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 font-extrabold transition ${
                page === p.id ? 'bg-brand text-white shadow-pop' : 'bg-card text-ink shadow-pop hover:text-link'
              }`}
            >
              {p.label}
              {p.id === 'settings' && updateAvailable && dot}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <button onClick={logout} className="rounded-full bg-card px-4 py-2 font-extrabold text-mute shadow-pop hover:text-bad">
            Выйти
          </button>
        </div>
      </header>

      <main key={page} className="pop min-w-0">
        {page === 'servers' && <ServersPage sub={sub} />}
        {page === 'cards' && <CardsPage />}
        {page === 'discord' && <DiscordPage />}
        {page === 'settings' && <SettingsPage sub={sub} updateAvailable={updateAvailable} />}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 backdrop-blur md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label="Разделы"
      >
        <ul className="mx-auto flex max-w-md">
          {PAGES.map((p) => {
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
                  {p.id === 'settings' && updateAvailable && <span className="absolute right-[26%] top-2 h-2.5 w-2.5 rounded-full bg-warn" />}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
