import { useCallback, useEffect, useState } from 'react';
import { getToken, setToken } from './api';
import Login from './pages/Login';
import ServersPage from './pages/Servers';
import CardsPage from './pages/Cards';
import DiscordPage from './pages/Discord';
import SettingsPage from './pages/Settings';

const PAGES = [
  { id: 'servers', label: 'Серверы' },
  { id: 'cards', label: 'Карточки' },
  { id: 'discord', label: 'Discord' },
  { id: 'settings', label: 'Настройки' },
] as const;
type PageId = (typeof PAGES)[number]['id'];

const readHash = (): PageId => {
  const h = window.location.hash.replace('#/', '');
  return (PAGES.find((p) => p.id === h)?.id ?? 'servers') as PageId;
};

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [page, setPage] = useState<PageId>(readHash());

  useEffect(() => {
    const h = () => setPage(readHash());
    const out = () => setAuthed(false);
    window.addEventListener('hashchange', h);
    window.addEventListener('coregsm:logout', out);
    return () => {
      window.removeEventListener('hashchange', h);
      window.removeEventListener('coregsm:logout', out);
    };
  }, []);

  const logout = useCallback(() => {
    setToken('');
    setAuthed(false);
  }, []);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  return (
    <div className="mx-auto min-h-full max-w-6xl px-4 pb-16 pt-5 sm:px-6">
      <header className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-3">
        <a href="#/servers" className="text-2xl font-black tracking-tight text-brand">coregsm</a>
        <nav className="flex max-w-full gap-1.5 overflow-x-auto" aria-label="Разделы">
          {PAGES.map((p) => (
            <a
              key={p.id}
              href={`#/${p.id}`}
              aria-current={page === p.id ? 'page' : undefined}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 font-extrabold transition ${
                page === p.id ? 'bg-brand text-white shadow-pop' : 'bg-white text-ink shadow-pop hover:text-brand'
              }`}
            >
              {p.label}
            </a>
          ))}
        </nav>
        <button onClick={logout} className="ml-auto rounded-full bg-white px-4 py-1.5 font-extrabold text-mute shadow-pop hover:text-bad">
          Выйти
        </button>
      </header>
      <main key={page} className="pop min-w-0">
        {page === 'servers' && <ServersPage />}
        {page === 'cards' && <CardsPage />}
        {page === 'discord' && <DiscordPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
