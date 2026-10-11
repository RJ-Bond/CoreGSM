import { useEffect, useState, type FormEvent } from 'react';
import { api, type Server } from '../api';
import { useAuth } from '../auth';
import { ErrorLine, Field, GameAvatar, IconServers, PageHead, StatusPill, toast } from '../ui';

/** The signed-in user's own page: account, password and favourite servers. */
export default function ProfilePage() {
  const { me, isAdmin, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [favs, setFavs] = useState<Server[] | null>(null);

  useEffect(() => {
    Promise.all([api<number[]>('/favorites'), api<Server[]>('/servers')])
      .then(([ids, servers]) => setFavs(servers.filter((s) => ids.includes(s.id))))
      .catch(() => setFavs([]));
  }, []);

  if (!me) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/auth/password', 'POST', { current, next });
      toast('Пароль изменён');
      setCurrent('');
      setNext('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHead title="Профиль" subtitle="Ваш аккаунт и избранные серверы" icon={<IconServers />} />

      <div className="grid items-start gap-5 md:grid-cols-2">
        <div className="panel flex items-center gap-4 p-5 md:col-span-2">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl bg-brand text-3xl font-black text-white">{me.username.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-2xl font-black">{me.username}</div>
            <span className={`pill ${isAdmin ? 'pill-ok' : 'pill-mute'}`}>{isAdmin ? 'АДМИНИСТРАТОР' : 'ИГРОК'}</span>
          </div>
          <button className="btn btn-soft" onClick={logout}>Выйти</button>
        </div>

        <form onSubmit={submit} className="panel space-y-3.5 p-6">
          <h2 className="text-lg font-black">Смена пароля</h2>
          <Field label="Текущий пароль">
            <input id="pf-current" className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </Field>
          <Field label="Новый пароль (от 8 символов)">
            <input id="pf-next" className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
          </Field>
          <ErrorLine text={error} />
          <button className="btn">Сохранить пароль</button>
        </form>

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
