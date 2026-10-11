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
    <div className="flex h-full flex-col md:flex-row">
      <aside className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-panel p-3 md:w-52 md:flex-col md:border-b-0 md:border-r md:p-4">
        <div className="mr-4 flex items-center font-semibold tracking-wider text-blurple-soft md:mb-5 md:mr-0">▌CORE//GSM</div>
        {PAGES.map((p) => (
          <a
            key={p.id}
            href={`#/${p.id}`}
            className={`whitespace-nowrap border-l-2 px-2.5 py-1.5 ${
              page === p.id ? 'border-blurple bg-raise text-blurple-soft' : 'border-transparent text-mute hover:text-fg'
            }`}
          >
            {p.label}
          </a>
        ))}
        <button onClick={logout} className="ml-auto whitespace-nowrap px-2.5 py-1.5 text-left text-mute hover:text-bad md:ml-0 md:mt-auto">
          Выйти
        </button>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-4 md:p-6">
        {page === 'servers' && <ServersPage />}
        {page === 'cards' && <CardsPage />}
        {page === 'discord' && <DiscordPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
