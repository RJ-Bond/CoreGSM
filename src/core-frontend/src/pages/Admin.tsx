import { useState, type ReactNode } from 'react';
import { api, type Server, type ServerInput } from '../api';
import { gameLabel } from '../games';
import { Empty, ErrorLine, GameAvatar, IconCards, IconDiscord, IconNews, IconServers, IconSettings, PageHead, StatusPill, ago, toast, usePoll } from '../ui';
import AlertsPage, { IconBell } from './Alerts';
import CardsPage from './Cards';
import DiscordPage from './Discord';
import NewsPage from './News';
import ServerForm, { emptyServer } from './ServerForm';
import JournalPage from './Journal';
import SettingsPage, { UsersTab } from './Settings';
import SystemPage from './System';

const IconUsers = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const IconJournal = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);
const IconSystem = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);

interface Section { id: string; label: string; icon: () => ReactNode }

export const ADMIN_SECTIONS: Section[] = [
  { id: 'servers', label: 'Серверы', icon: IconServers },
  { id: 'discord', label: 'Discord', icon: IconDiscord },
  { id: 'news', label: 'Новости', icon: IconNews },
  { id: 'alerts', label: 'Оповещения', icon: IconBell },
  { id: 'cards', label: 'Карточки', icon: IconCards },
  { id: 'users', label: 'Пользователи', icon: IconUsers },
  { id: 'journal', label: 'Журнал', icon: IconJournal },
  { id: 'system', label: 'Система', icon: IconSystem },
  { id: 'settings', label: 'Настройки', icon: IconSettings },
];

/** The administrator's area: everything that changes the panel lives here. */
export default function AdminPage({ sub, updateAvailable }: { sub: string; updateAvailable: boolean }) {
  const [section, ...rest] = sub.split('/');
  const current = ADMIN_SECTIONS.some((s) => s.id === section) ? section : 'servers';
  const tail = rest.join('/');

  return (
    <div className="grid gap-5 md:grid-cols-[13rem_minmax(0,1fr)]">
      <nav className="flex gap-1 overflow-x-auto rounded-3xl border border-line bg-card p-1.5 shadow-soft md:sticky md:top-4 md:flex-col md:self-start md:overflow-visible md:p-2" aria-label="Разделы админки">
        <div className="hidden px-3 pb-1 pt-2 text-xs font-extrabold uppercase tracking-wider text-mute md:block">Админка</div>
        {ADMIN_SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#/admin/${s.id}`}
            aria-current={current === s.id ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-2xl px-3.5 py-2 font-bold transition ${current === s.id ? 'bg-brand text-white shadow-pop' : 'text-mute hover:bg-soft hover:text-ink'}`}
          >
            {s.icon()}
            {s.label}
            {s.id === 'settings' && updateAvailable && <span className="h-2 w-2 rounded-full bg-warn" title="Доступно обновление" />}
          </a>
        ))}
      </nav>
      <div className="min-w-0">
        {current === 'servers' && <ServersManage />}
        {current === 'discord' && <DiscordPage />}
        {current === 'news' && <NewsPage sub={tail} />}
        {current === 'alerts' && <AlertsPage />}
        {current === 'cards' && <CardsPage />}
        {current === 'users' && <UsersTab />}
        {current === 'journal' && <JournalPage />}
        {current === 'system' && <SystemPage />}
        {current === 'settings' && <SettingsPage sub={tail} updateAvailable={updateAvailable} />}
      </div>
    </div>
  );
}

/** Add, edit, delete and re-query servers. */
function ServersManage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<{ id?: number; data: ServerInput } | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = () =>
    api<Server[]>('/servers')
      .then((s) => { setServers(s); setError(''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  usePoll(load, 15_000);

  const remove = async (s: Server) => {
    if (!window.confirm(`Удалить сервер «${s.name}» вместе с привязками к Discord?`)) return;
    await api(`/servers/${s.id}`, 'DELETE').then(() => toast('Сервер удалён')).catch((e: Error) => setError(e.message));
    void load();
  };
  const refresh = async (s: Server) => {
    setBusyId(s.id);
    await api(`/servers/${s.id}/refresh`, 'POST').catch((e: Error) => setError(e.message));
    await load();
    setBusyId(null);
  };

  return (
    <div className="space-y-5">
      <PageHead title="Серверы" subtitle="Добавление и настройка игровых серверов" icon={<IconServers />}>
        <button className="btn" onClick={() => setEditing({ data: emptyServer })}>+ Добавить сервер</button>
      </PageHead>
      <ErrorLine text={error} />

      {loaded && servers.length === 0 && (
        <Empty title="Серверов пока нет" text="Укажите игру и адрес, и панель начнёт показывать онлайн, карту и пинг.">
          <button className="btn mt-3" onClick={() => setEditing({ data: emptyServer })}>+ Добавить сервер</button>
        </Empty>
      )}

      <div className="space-y-2.5">
        {servers.map((s) => (
          <div key={s.id} className="panel flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
            <GameAvatar game={s.game} size={40} />
            <div className="min-w-0 flex-1 basis-56">
              <a href={`#/servers/${s.id}`} className="block break-words font-extrabold leading-tight hover:text-link">{s.name}</a>
              <div className="truncate text-sm font-semibold text-mute">
                {gameLabel(s.game)} · <span className="font-mono">{s.host}:{s.port}</span>
                {s.displayAddress ? <> · показывается как <span className="font-mono">{s.displayAddress}</span></> : null}
              </div>
            </div>
            <div className="text-sm font-bold tabular-nums text-mute">{s.online ? `${s.players}/${s.maxPlayers}` : ''}</div>
            <StatusPill online={s.online} known={s.hasStatus} lag={s.ping != null && s.ping > 100} />
            <span className="hidden text-sm font-semibold text-mute lg:inline">{ago(s.updatedAt)}</span>
            <div className="flex gap-2">
              <button className="btn btn-soft btn-sm" onClick={() => void refresh(s)} disabled={busyId === s.id}>{busyId === s.id ? '…' : 'Опросить'}</button>
              <button className="btn btn-soft btn-sm" onClick={() => setEditing({ id: s.id, data: { name: s.customName, game: s.game, host: s.host, port: s.port, queryPort: s.queryPort, displayAddress: s.displayAddress } })}>Изменить</button>
              <button className="btn btn-danger btn-sm" onClick={() => void remove(s)}>Удалить</button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <ServerForm
          initial={editing.data}
          id={editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); toast('Сервер сохранён'); void load(); }}
        />
      )}
    </div>
  );
}
