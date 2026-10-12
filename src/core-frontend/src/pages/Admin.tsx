import { useEffect, useState, type ReactNode } from 'react';
import { api, type CertInfo, type Server, type ServerInput } from '../api';
import { useAuth } from '../auth';
import { confirmDialog } from '../confirm';
import { gameLabel } from '../games';
import { Empty, ErrorLine, GameAvatar, IconCards, IconDiscord, IconNews, IconRefresh, IconServers, IconSettings, PageHead, StatusPill, ago, plural, toast, usePoll } from '../ui';
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
  const { isAdmin } = useAuth();
  const [section, ...rest] = sub.split('/');
  // a moderator sees only the news section; everything else is for administrators
  const sections = isAdmin ? ADMIN_SECTIONS : ADMIN_SECTIONS.filter((s) => s.id === 'news');
  const current = sections.some((s) => s.id === section) ? section : sections[0].id;
  // the sub-path belongs to the section that was asked for, not to the fallback
  const tail = current === section ? rest.join('/') : '';

  return (
    <div className="grid gap-4 md:grid-cols-[13.5rem_minmax(0,1fr)]">
      <nav className="tile flex gap-1 overflow-x-auto p-1.5 md:sticky md:top-24 md:flex-col md:self-start md:overflow-visible md:p-2.5" aria-label="Разделы админки">
        <div className="hidden px-3 pb-1 pt-1.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-mute md:block">Админка</div>
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#/admin/${s.id}`}
            aria-current={current === s.id ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[14px] px-3.5 py-2 text-sm font-bold transition max-md:rounded-full ${current === s.id ? 'bg-gradient-to-br from-brand to-brand-2 text-white shadow-pop' : 'text-mute hover:bg-soft hover:text-ink'}`}
          >
            {s.icon()}
            {s.label}
            {s.id === 'settings' && updateAvailable && <span className="h-2 w-2 rounded-full bg-warn" title="Доступно обновление" />}
          </a>
        ))}
      </nav>
      <div className="min-w-0 space-y-5">
        {isAdmin && <CertWarning />}
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

const CERT_DISMISSED = 'coregsm_cert_warning_dismissed';
const certDismissed = () => {
  try { return sessionStorage.getItem(CERT_DISMISSED) === '1'; } catch { return false; }
};

/** A slim banner for administrators when the HTTPS certificate is about to expire (or already has). */
function CertWarning() {
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
    ? 'Сертификат HTTPS истёк.'
    : `Сертификат HTTPS истекает через ${d} ${plural(d, ['день', 'дня', 'дней'])}.`;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-2.5 text-sm font-bold ${expired ? 'bg-badbg text-bad' : 'bg-warnbg text-warn'}`} role={expired ? 'alert' : 'status'}>
      <span className="min-w-0 flex-1">{text} <a href="#/admin/system" className="underline">Подробнее</a></span>
      <button
        type="button"
        className="rounded-full px-2 py-0.5 font-extrabold hover:bg-black/5"
        aria-label="Скрыть предупреждение до конца сессии"
        onClick={() => { try { sessionStorage.setItem(CERT_DISMISSED, '1'); } catch { /* not remembered */ } setHidden(true); }}
      >
        ✕
      </button>
    </div>
  );
}

/** Add, edit, delete and re-query servers. */
function ServersManage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<{ id?: number; data: ServerInput; cover?: string | null } | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = () =>
    api<Server[]>('/servers')
      .then((s) => { setServers(s); setError(''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  usePoll(load, 15_000);

  const remove = async (s: Server) => {
    if (!(await confirmDialog({ title: `Удалить сервер «${s.name}»?`, text: 'Сервер будет удалён вместе с привязками к Discord.', confirmLabel: 'Удалить', danger: true }))) return;
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
        <button className="btn" data-magnetic onClick={() => setEditing({ data: emptyServer })}>+ Добавить сервер</button>
      </PageHead>
      <ErrorLine text={error} />

      {!loaded && (
        <div className="space-y-3" aria-busy="true" aria-label="Загрузка">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton tile h-[74px]" />)}
        </div>
      )}

      {loaded && servers.length === 0 && (
        <Empty title="Серверов пока нет" text="Укажите игру и адрес, и панель начнёт показывать онлайн, карту и пинг.">
          <button className="btn mt-3" onClick={() => setEditing({ data: emptyServer })}>+ Добавить сервер</button>
        </Empty>
      )}

      <div className="fade-in space-y-3">
        {servers.map((s) => (
          <div key={s.id} className="tile flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
            <GameAvatar game={s.game} size={44} />
            <div className="min-w-0 flex-1 basis-56">
              <a href={`#/servers/${s.id}`} className="block break-words font-extrabold leading-tight hover:text-link">{s.name}</a>
              <div className="truncate text-sm font-semibold text-mute">
                {gameLabel(s.game)} · <span className="font-mono">{s.host}:{s.port}</span>
                {s.displayAddress ? <> · показывается как <span className="font-mono">{s.displayAddress}</span></> : null}
              </div>
            </div>
            <div className="min-w-[3.5rem] text-right text-sm font-bold tabular-nums text-mute">{s.online ? <><b className="text-lg font-extrabold text-ink">{s.players}</b>/{s.maxPlayers}</> : '—'}</div>
            <StatusPill online={s.online} known={s.hasStatus} lag={s.ping != null && s.ping > 100} />
            <span className="hidden text-sm font-semibold text-mute lg:inline">{ago(s.updatedAt)}</span>
            <div className="flex gap-2">
              <button className="btn btn-soft btn-sm" onClick={() => void refresh(s)} disabled={busyId === s.id} aria-busy={busyId === s.id || undefined}><IconRefresh spinning={busyId === s.id} />Опросить</button>
              <button className="btn btn-soft btn-sm" onClick={() => setEditing({ id: s.id, data: { name: s.customName, game: s.game, host: s.host, port: s.port, queryPort: s.queryPort, displayAddress: s.displayAddress, country: s.country }, cover: s.coverUrl })}>Изменить</button>
              <button className="btn btn-danger btn-sm" onClick={() => void remove(s)}>Удалить</button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <ServerForm
          initial={editing.data}
          id={editing.id}
          coverUrl={editing.cover}
          onCoverChanged={() => void load()}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); toast('Сервер сохранён'); void load(); }}
        />
      )}
    </div>
  );
}
