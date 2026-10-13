import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type CertInfo, type Server, type ServerInput, type UpdateInfo } from '../api';
import { useAuth } from '../auth';
import { confirmDialog } from '../confirm';
import { gameLabel } from '../games';
import { AdminPage as PageStack, Empty, ErrorLine, GameAvatar, IconArrowUp, LoadError, IconClose, IconEdit, IconRefresh, IconServers, IconTrash, PageHead, StatusPill, ago, plural, toast, usePoll } from '../ui';
import { ADMIN_GROUPS, ADMIN_SECTIONS, START_SECTION, type AdminSection } from './adminNav';
import { PINS_KEY, PINS_MAX, RECENT_KEY, RECENT_MAX, pushRecent, readIds, togglePin, writeIds } from './adminShortcuts';
import AdminStart, { AdminHome } from './AdminStart';
import AlertsPage from './Alerts';
import CardsPage from './Cards';
import DiscordPage from './Discord';
import NewsPage from './News';
import ServerForm, { emptyServer } from './ServerForm';
import JournalPage from './Journal';
import SettingsPage, { UsersTab } from './Settings';

export { ADMIN_SECTIONS };
import SystemPage from './System';

/** The administrator's area: everything that changes the panel lives here. */
export default function AdminPage({ sub, updateAvailable }: { sub: string; updateAvailable: boolean }) {
  const { isAdmin } = useAuth();
  const [section, ...rest] = sub.split('/');
  // a moderator sees only the news section; everything else is for administrators
  const sections = isAdmin ? ADMIN_SECTIONS : ADMIN_SECTIONS.filter((s) => s.id === 'news');
  const known = sections.some((s) => s.id === section);
  // bare #/admin (or an unknown section): administrators land on «Начало работы» or «Серверы», see AdminHome
  const home = isAdmin && !known;
  const current = known ? section : sections[0].id;
  // the sub-path belongs to the section that was asked for, not to the fallback
  const tail = current === section ? rest.join('/') : '';
  // «Недавние» (the last visited sections) and «Закреплённые» (stars): this browser only
  const validIds = useMemo(() => ADMIN_SECTIONS.map((x) => x.id), []);
  const [pins, setPins] = useState<string[]>(() => readIds(PINS_KEY, validIds, PINS_MAX));
  const [recent, setRecent] = useState<string[]>(() => readIds(RECENT_KEY, validIds, RECENT_MAX));
  useEffect(() => {
    if (!isAdmin || home || current === 'start') return;
    setRecent((r) => {
      if (r[0] === current) return r;
      const n = pushRecent(r, current);
      writeIds(RECENT_KEY, n);
      return n;
    });
  }, [current, home, isAdmin]);
  const pin = (s: AdminSection) => {
    const r = togglePin(pins, s.id);
    if (r.full) { toast(`Можно закрепить не больше ${PINS_MAX} разделов`, 'info'); return; }
    setPins(r.pins);
    writeIds(PINS_KEY, r.pins);
  };
  const byId = (id: string) => ADMIN_SECTIONS.find((x) => x.id === id);
  const pinned = pins.map(byId).filter((x): x is AdminSection => !!x);
  const recents = recent.filter((id) => id !== current && !pins.includes(id)).map(byId).filter((x): x is AdminSection => !!x);

  /** a link, and (for admins) the star that pins it: a sibling button, never a button inside the link */
  const item = (s: AdminSection, scope = '') => {
    const on = pins.includes(s.id);
    return (
      <div key={`${scope}${s.id}`} className="adm-item" data-current={current === s.id ? 'true' : undefined} data-pinned={on ? 'true' : undefined}>
        {link(s, true)}
        <button
          type="button"
          className="adm-pin"
          aria-pressed={on}
          aria-label={`${on ? 'Открепить' : 'Закрепить'}: ${s.label}`}
          title={on ? 'Открепить' : 'Закрепить вверху'}
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
      href={`#/admin/${s.id}`}
      aria-current={current === s.id ? 'page' : undefined}
      className={`flex min-w-0 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[14px] px-3.5 py-2 text-sm font-bold transition max-md:rounded-full ${pinnable ? 'md:w-full md:pr-9' : ''} ${current === s.id ? 'bg-gradient-to-br from-brand to-brand-2 text-white shadow-pop' : 'text-mute hover:bg-soft hover:text-ink'}`}
    >
      {s.icon()}
      {s.label}
      {s.id === 'settings' && updateAvailable && <span className="update-dot ml-auto" title="Доступно обновление" />}
    </a>
  );
  const divider = <span aria-hidden className="mx-1 w-px shrink-0 self-stretch bg-line md:hidden" />;

  return (
    <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
      <nav className="tile flex items-stretch gap-1 overflow-x-auto p-1.5 md:sticky md:top-24 md:max-h-[calc(100dvh-7rem)] md:flex-col md:items-stretch md:self-start md:overflow-y-auto md:p-2.5" aria-label="Разделы админки">
        {isAdmin ? (
          <>
            {link(START_SECTION)}
            {pinned.length > 0 && (
              <div className="contents md:block">
                {divider}
                <div id="adm-g-pins" className="adm-group-title hidden md:block">Закреплённые</div>
                <div role="group" aria-labelledby="adm-g-pins" aria-label="Закреплённые" className="flex gap-1 md:flex-col">
                  {pinned.map((s) => item(s, 'p-'))}
                </div>
              </div>
            )}
            {recents.length > 0 && (
              <div className="hidden md:block">
                <div id="adm-g-recent" className="adm-group-title">Недавние</div>
                <div role="group" aria-labelledby="adm-g-recent" className="flex flex-col gap-1">
                  {recents.map((s) => item(s, 'r-'))}
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
            <div className="hidden px-3 pb-1 pt-1.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-mute md:block">Админка</div>
            {sections.map((s) => link(s))}
          </>
        )}
      </nav>
      <div className="min-w-0 space-y-5">
        {isAdmin && updateAvailable && current !== 'settings' && <UpdateBanner />}
        {isAdmin && <CertWarning />}
        {home && <AdminHome />}
        {!home && current === 'start' && <AdminStart />}
        {!home && current === 'servers' && <ServersManage sub={tail} />}
        {!home && current === 'discord' && <DiscordPage sub={tail} />}
        {!home && current === 'news' && <NewsPage sub={tail} />}
        {!home && current === 'alerts' && <AlertsPage />}
        {!home && current === 'cards' && <CardsPage />}
        {!home && current === 'users' && <UsersTab />}
        {!home && current === 'journal' && <JournalPage />}
        {!home && current === 'system' && <SystemPage />}
        {!home && current === 'settings' && <SettingsPage sub={tail} updateAvailable={updateAvailable} />}
      </div>
    </div>
  );
}

/** A banner at the top of the admin area while a new version is waiting; it follows the running update. */
function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [offline, setOffline] = useState(false);
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
  const pct = typeof info?.job?.progress === "number" ? Math.max(0, Math.min(100, Math.round(info.job.progress))) : null;
  const latest = info?.latest ?? null;
  return (
    <div className="update-hero relative flex flex-wrap items-center gap-x-4 gap-y-2 overflow-hidden rounded-[22px] px-5 py-3.5 text-white" role="status">
      <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/15" />
      <span aria-hidden className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/20">
        {running ? <IconRefresh spinning /> : <IconArrowUp className="update-bob" />}
      </span>
      <div className="relative min-w-0 flex-1">
        {running ? (
          <>
            <div className="font-extrabold leading-tight">{offline ? "Панель перезапускается…" : "Идёт обновление панели"}{pct != null && !offline ? ` · ${pct}%` : ""}</div>
            <div className="text-sm font-semibold text-white/90">{offline ? "Это занимает 1-3 минуты, страница обновится сама." : info?.job?.message || "Устанавливаю новую сборку…"}</div>
            {pct != null && !offline && <div className="update-progress det mt-1.5" style={{ ["--p" as string]: `${pct}%` }}><i /></div>}
          </>
        ) : failed ? (
          <>
            <div className="font-extrabold leading-tight">Обновление не удалось</div>
            <div className="text-sm font-semibold text-white/90">{info?.job?.message || "Подробности на странице обновлений."}</div>
          </>
        ) : (
          <>
            <div className="font-extrabold leading-tight">Доступно обновление панели</div>
            <div className="text-sm font-semibold text-white/90">Новая сборка {latest ? <span className="font-mono">{latest.slice(0, 7)}</span> : ""} готова к установке.</div>
          </>
        )}
      </div>
      <a href="#/admin/settings/updates" className="btn-on-grad relative">{running ? "Подробнее" : failed ? "Открыть" : "Обновить"}</a>
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
        <IconClose size={14} />
      </button>
    </div>
  );
}

/** Add, edit, delete and re-query servers. */
function ServersManage({ sub }: { sub: string }) {
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

  // #/admin/servers/new opens the «add» form (links from the start page and Ctrl+K)
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
    if (sub === 'new') window.location.hash = '#/admin/servers';
  };

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
    <PageStack
      head={(
        <PageHead
          title="Серверы"
          subtitle="Добавление и настройка игровых серверов"
          icon={<IconServers />}
          hint="Список игровых серверов, которые показывает панель. Добавьте сервер, и онлайн, карта и пинг начнут обновляться сами."
          help={<p>Укажите игру, адрес и порт. Если игрокам нужно показывать другой адрес, заполните поле «Показывать как». Чтобы бот писал о сервере в Discord, нажмите «Привязать к Discord» в его строке.</p>}
        >
          <button className="btn" data-magnetic data-tour="add-server" onClick={() => setEditing({ data: emptyServer })}>+ Добавить сервер</button>
        </PageHead>
      )}
    >
      {error && servers.length === 0 ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}

      {!loaded && (
        <div className="space-y-3" aria-busy="true" aria-label="Загрузка">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton tile h-[74px]" />)}
        </div>
      )}

      {loaded && !error && servers.length === 0 && (
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
            <div className="ml-auto flex flex-wrap items-center gap-1.5 max-sm:w-full max-sm:justify-end" role="group" aria-label={`Действия: ${s.name}`}>
              <a className="btn btn-soft btn-sm" href={`#/admin/discord/new/${s.id}`}>Привязать к Discord</a>
              <button type="button" className="row-act" title="Опросить сейчас" aria-label="Опросить сейчас" onClick={() => void refresh(s)} disabled={busyId === s.id} aria-busy={busyId === s.id || undefined}>
                <IconRefresh spinning={busyId === s.id} />
              </button>
              <button type="button" className="row-act" title="Изменить" aria-label="Изменить" onClick={() => setEditing({ id: s.id, data: { name: s.customName, game: s.game, host: s.host, port: s.port, queryPort: s.queryPort, displayAddress: s.displayAddress, country: s.country }, cover: s.coverUrl })}>
                <IconEdit />
              </button>
              <button type="button" className="row-act row-act-danger" title="Удалить" aria-label="Удалить" onClick={() => void remove(s)}>
                <IconTrash />
              </button>
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
          onClose={closeForm}
          onSaved={() => { closeForm(); toast('Сервер сохранён'); void load(); }}
        />
      )}
    </PageStack>
  );
}
