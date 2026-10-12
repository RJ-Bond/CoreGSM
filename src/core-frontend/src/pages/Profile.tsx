import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, getToken, type Server, type Session } from '../api';
import { useAuth } from '../auth';
import { ago, ErrorLine, FieldError, GameAvatar, IconServers, PageHead, PasswordField, PasswordStrength, StatusPill, UserAvatar, toast } from '../ui';

/** "Chrome · Windows" from a User-Agent string */
function deviceName(ua: string): string {
  if (!ua) return 'Неизвестное устройство';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /YaBrowser/.test(ua) ? 'Яндекс Браузер'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : '';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return [browser, os].filter(Boolean).join(' · ') || ua.slice(0, 40);
}

/** The signed-in user's own page: account, password, Discord, sessions and favourite servers. */
export default function ProfilePage() {
  const { me, isAdmin, logout, reload } = useAuth();
  const [favs, setFavs] = useState<Server[] | null>(null);

  useEffect(() => {
    Promise.all([api<number[]>('/favorites'), api<Server[]>('/servers')])
      .then(([ids, servers]) => setFavs(servers.filter((s) => ids.includes(s.id))))
      .catch(() => setFavs([]));
  }, []);

  if (!me) return null;

  return (
    <div className="space-y-6">
      <PageHead title="Профиль" subtitle="Ваш аккаунт, безопасность и избранные серверы" icon={<IconServers />} />

      <div className="grid items-start gap-5 md:grid-cols-2">
        <div className="panel flex flex-wrap items-center gap-4 p-5 md:col-span-2">
          <UserAvatar name={me.username} url={me.avatarUrl} size={64} tone="brand" className="!rounded-3xl" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-2xl font-black">{me.username}</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`pill ${isAdmin ? 'pill-ok' : 'pill-mute'}`}>{isAdmin ? 'АДМИНИСТРАТОР' : 'ИГРОК'}</span>
              {me.discordName && <span className="text-sm font-bold text-mute">Discord: {me.discordName}</span>}
            </div>
          </div>
          <button className="btn btn-soft" onClick={logout}>Выйти</button>
        </div>

        <PasswordCard hasPassword={me.hasPassword} onChanged={reload} />
        <DiscordCard onChanged={reload} />
        <SessionsCard />

        <div className="panel space-y-3 p-6">
          <h2 className="text-lg font-black">Избранные серверы</h2>
          {favs === null && <div className="skeleton h-20 rounded-2xl bg-soft" />}
          {favs && favs.length === 0 && <p className="font-semibold text-mute">Пока ничего нет. Отмечайте серверы звёздочкой на странице «Серверы»: они будут показаны первыми.</p>}
          {favs?.map((s) => (
            <a key={s.id} href={`#/servers/${s.id}`} className="flex items-center gap-3 rounded-2xl bg-soft px-3 py-2.5 transition hover:ring-2 hover:ring-brand/30">
              <GameAvatar game={s.game} size={36} />
              <span className="min-w-0 flex-1 truncate font-bold">{s.name}</span>
              <StatusPill online={s.online} known={s.hasStatus} />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function PasswordCard({ hasPassword, onChanged }: { hasPassword: boolean; onChanged: () => Promise<void> }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [curErr, setCurErr] = useState('');
  const [nextErr, setNextErr] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const curRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setCurErr(''); setNextErr(''); setError('');
    if (hasPassword && !current) { setCurErr('Введите текущий пароль'); curRef.current?.focus(); return; }
    if (next.length < 8) { setNextErr('Пароль должен быть не короче 8 символов'); nextRef.current?.focus(); return; }
    setBusy(true);
    try {
      await api('/auth/password', 'POST', hasPassword ? { current, next } : { next });
      toast(hasPassword ? 'Пароль изменён' : 'Пароль задан');
      setCurrent('');
      setNext('');
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="panel space-y-3.5 p-6">
      <h2 className="text-lg font-black">{hasPassword ? 'Смена пароля' : 'Задать пароль'}</h2>
      {!hasPassword && <p className="font-semibold text-mute">Сейчас вы входите только через Discord. Пароль позволит входить и по логину.</p>}
      {hasPassword && (
        <PasswordField id="pf-current" ref={curRef} label="Текущий пароль" value={current} onChange={setCurrent} autoComplete="current-password" error={curErr} />
      )}
      <PasswordField id="pf-next" ref={nextRef} label="Новый пароль (от 8 символов)" value={next} onChange={setNext} autoComplete="new-password" error={nextErr}>
        <PasswordStrength password={next} />
      </PasswordField>
      <ErrorLine text={error} />
      <button className="btn" disabled={busy}>{hasPassword ? 'Сохранить пароль' : 'Задать пароль'}</button>
    </form>
  );
}

function DiscordCard({ onChanged }: { onChanged: () => Promise<void> }) {
  const { me, access } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  const unlink = async () => {
    if (!window.confirm('Отвязать Discord от аккаунта?')) return;
    setBusy(true);
    setError('');
    try {
      await api('/me/discord', 'DELETE');
      toast('Discord отвязан');
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const link = () => { window.location.href = `/api/auth/discord/start?mode=link&t=${encodeURIComponent(getToken())}`; };

  return (
    <div className="panel space-y-3.5 p-6">
      <h2 className="text-lg font-black">Discord</h2>
      {me.discordName ? (
        <>
          <div className="flex items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
            <UserAvatar name={me.discordName} url={me.avatarUrl} size={40} tone="brand" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-extrabold">{me.discordName}</div>
              <div className="text-sm font-semibold text-mute">Аккаунт привязан</div>
            </div>
            <button className="btn btn-danger btn-sm" onClick={() => void unlink()} disabled={busy}>Отвязать</button>
          </div>
          <ErrorLine text={error} />
        </>
      ) : (
        <>
          <p className="font-semibold text-mute">
            {access.discordLogin ? 'Привяжите Discord, чтобы входить в одно касание и видеть свой аватар.' : 'Вход через Discord пока не настроен администратором.'}
          </p>
          <button className="btn" onClick={link} disabled={!access.discordLogin}>Привязать Discord</button>
        </>
      )}
    </div>
  );
}

function SessionsCard() {
  const [list, setList] = useState<Session[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Session[]>('/sessions').then(setList).catch((e: Error) => { setList([]); setError(e.message); });
  }, []);
  useEffect(load, [load]);

  const end = async (s: Session) => {
    setError('');
    await api(`/sessions/${s.id}`, 'DELETE').then(() => toast('Сеанс завершён')).catch((e: Error) => setError(e.message));
    load();
  };
  const endOthers = async () => {
    if (!window.confirm('Завершить все сеансы, кроме этого?')) return;
    setBusy(true);
    setError('');
    await api<{ revoked: number }>('/sessions/revoke-others', 'POST')
      .then((r) => toast(`Завершено сеансов: ${r.revoked}`))
      .catch((e: Error) => setError(e.message));
    setBusy(false);
    load();
  };

  const others = list?.filter((s) => !s.current).length ?? 0;

  return (
    <div className="panel space-y-3 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black">Сеансы</h2>
        {others > 0 && <button className="btn btn-soft btn-sm" onClick={() => void endOthers()} disabled={busy}>Завершить все остальные</button>}
      </div>
      {list === null && <div className="skeleton h-16 rounded-2xl bg-soft" />}
      <ul className="space-y-2">
        {list?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl bg-soft px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-extrabold">{deviceName(s.ua)}</span>
                {s.current && <span className="pill pill-ok">ЭТО УСТРОЙСТВО</span>}
              </div>
              <div className="truncate text-sm font-semibold text-mute">
                {s.ip || 'IP неизвестен'} · {s.current ? 'сейчас' : ago(s.lastSeen)}
              </div>
            </div>
            {!s.current && <button className="btn btn-danger btn-sm" onClick={() => void end(s)}>Завершить</button>}
          </li>
        ))}
      </ul>
      <FieldError id="sessions-err" text={error} />
    </div>
  );
}
