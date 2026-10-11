import { useEffect, useState, type FormEvent } from 'react';
import { api, getToken, type Access, type BotStatus, type SettingsInfo, type UpdateInfo, type UserRow } from '../api';
import { useAuth } from '../auth';
import { ErrorLine, Field, IconSettings, Logo, InviteButton, PageHead, ProxyField, toast, usePoll, type ProxyType } from '../ui';

export function BotPill({ status, tokenSet }: { status: BotStatus | null; tokenSet: boolean }) {
  if (!tokenSet) return <span className="pill pill-mute">ТОКЕН НЕ ЗАДАН</span>;
  if (!status) return <span className="pill pill-mute">ПРОВЕРКА</span>;
  switch (status.state) {
    case 'online': return <span className="pill pill-ok">ПОДКЛЮЧЁН{status.tag ? ` · ${status.tag}` : ''}</span>;
    case 'connecting': return <span className="pill pill-warn">ПОДКЛЮЧАЕТСЯ</span>;
    case 'error': return <span className="pill pill-bad">ОШИБКА</span>;
    default: return <span className="pill pill-mute">ОЖИДАНИЕ</span>;
  }
}

/** название, цвет и логотип сообщества */
function BrandCard() {
  const { access, reload } = useAuth();
  const b = access.brand;
  const [name, setName] = useState(b.name);
  const [color, setColor] = useState(b.color);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const swatches = ['#4f46e5', '#7c3aed', '#db2777', '#e11d48', '#ea580c', '#16a34a', '#0891b2', '#2563eb'];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    await api('/branding', 'PUT', { name, color }).then(() => { toast('Оформление сохранено'); return reload(); }).catch((x: Error) => setError(x.message));
  };
  const upload = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/branding/logo', { method: 'PUT', headers: { 'Content-Type': file.type, Authorization: `Bearer ${getToken() ?? ''}` }, body: file });
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Не удалось загрузить');
      toast('Логотип обновлён');
      await reload();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const clearLogo = async () => { await api('/branding/logo', 'DELETE').catch(() => undefined); toast('Логотип сброшен'); await reload(); };

  return (
    <form onSubmit={save} className="panel space-y-5 p-6">
      <div>
        <h2 className="text-lg font-black">Оформление</h2>
        <p className="font-semibold text-mute">Название, цвет и логотип вашего сообщества. Они видны в панели, на странице входа и в подвале сообщений Discord.</p>
      </div>
      <Field label="Название">
        <input id="brand-name" className="input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div>
        <span className="label">Цвет</span>
        <div className="flex flex-wrap items-center gap-2">
          {swatches.map((c) => (
            <button type="button" key={c} onClick={() => setColor(c)} aria-label={c} aria-pressed={color === c} className={`h-9 w-9 rounded-full ring-offset-2 ring-offset-card transition ${color === c ? 'ring-2 ring-ink' : ''}`} style={{ background: c }} />
          ))}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-card" aria-label="Свой цвет" />
        </div>
      </div>
      <div>
        <span className="label">Логотип</span>
        <div className="flex flex-wrap items-center gap-3">
          <Logo size={48} />
          <label className="btn btn-soft btn-sm cursor-pointer">
            {busy ? 'Загружаю…' : 'Загрузить картинку'}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
          </label>
          {b.hasLogo && <button type="button" className="btn btn-soft btn-sm" onClick={() => void clearLogo()}>Сбросить</button>}
          <span className="text-sm font-semibold text-mute">PNG, JPG или WebP до 3 МБ, лучше квадрат</span>
        </div>
      </div>
      <ErrorLine text={error} />
      <button className="btn">Сохранить</button>
    </form>
  );
}

const TABS = [
  { id: 'bot', label: 'Discord-бот' },
  { id: 'brand', label: 'Оформление' },
  { id: 'security', label: 'Безопасность' },
  { id: 'updates', label: 'Обновления' },
] as const;

export default function SettingsPage({ sub, updateAvailable }: { sub: string; updateAvailable: boolean }) {
  const tab = TABS.some((t) => t.id === sub) ? sub : 'bot';
  return (
    <div className="space-y-6">
      <PageHead icon={<IconSettings />} title="Настройки" subtitle="Discord-бот, оформление, безопасность и обновления" />
      <nav className="flex w-full max-w-xl gap-1 overflow-x-auto rounded-full bg-soft p-1" aria-label="Разделы настроек">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`#/admin/settings/${t.id}`}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`flex-1 whitespace-nowrap rounded-full px-4 py-1.5 text-center font-extrabold transition ${tab === t.id ? 'bg-brand text-white shadow-pop' : 'text-mute hover:text-ink'}`}
          >
            {t.label}
            {t.id === 'updates' && updateAvailable && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-warn align-middle" title="Доступно обновление" />}
          </a>
        ))}
      </nav>
      <div className="max-w-2xl space-y-5">
        {tab === 'bot' && <BotCard />}
        {tab === 'brand' && <BrandCard />}
        {tab === 'security' && (
          <>
            <PasswordCard />
            <p className="font-semibold text-mute">
              Домен и порты задаются при установке и хранятся в <span className="font-mono text-sm text-ink">/app/.env</span>. Изменить их можно командой <span className="font-mono text-sm text-ink">sudo coregsm</span> на сервере (пункт «Домен и прокси»).
            </p>
          </>
        )}
        {tab === 'updates' && <UpdateCard />}
      </div>
    </div>
  );
}

function BotCard() {
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [token, setTokenValue] = useState('');
  const [proxy, setProxy] = useState('');
  const [proxyType, setProxyType] = useState<ProxyType>('socks5');
  const [clearProxy, setClearProxy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  usePoll(() => {
    api<SettingsInfo>('/settings').then(setInfo).catch(() => undefined);
    api<BotStatus>('/bot/status').then(setStatus).catch(() => undefined);
  }, 5_000);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const body: { discordToken?: string; proxyUrl?: string; proxyType?: ProxyType } = {};
      if (token.trim()) body.discordToken = token.trim();
      if (clearProxy) body.proxyUrl = '';
      else if (proxy.trim()) { body.proxyUrl = proxy.trim(); body.proxyType = proxyType; }
      const r = await api<SettingsInfo>('/settings', 'PUT', body);
      setInfo(r);
      setTokenValue('');
      setProxy('');
      setClearProxy(false);
      setSaved(true);
      toast('Настройки сохранены');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeToken = async () => {
    if (!window.confirm('Удалить токен? Бот перестанет обновлять карточки.')) return;
    try {
      setInfo(await api<SettingsInfo>('/settings', 'PUT', { discordToken: '' }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const tokenSet = !!info?.discordTokenSet;

  return (
    <form onSubmit={save} className="panel space-y-3.5 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black">Discord-бот</h2>
        <BotPill status={status} tokenSet={tokenSet} />
      </div>
      {tokenSet && status?.state === 'error' && status.error && (
        <p className="rounded-2xl bg-badbg px-4 py-2.5 text-sm font-bold text-bad">{status.error}</p>
      )}

      <Field label="Токен бота">
        <input
          id="set-token"
          className="input font-mono"
          type="password"
          value={token}
          onChange={(e) => setTokenValue(e.target.value)}
          autoComplete="off"
          placeholder={tokenSet ? `сохранён (${info?.discordTokenHint}), введите новый для замены` : 'вставьте токен из Developer Portal'}
        />
      </Field>
      {tokenSet && (
        <button type="button" className="text-sm font-extrabold text-bad hover:underline" onClick={removeToken}>Удалить сохранённый токен</button>
      )}

      <Field label="Прокси (необязательно)">
        <ProxyField
          id="set-proxy"
          value={clearProxy ? '' : proxy}
          type={proxyType}
          onChange={setProxy}
          onType={setProxyType}
          disabled={clearProxy}
          placeholder={info?.proxyUrl ? `сейчас: ${info.proxyUrl}` : undefined}
        />
      </Field>
      {info?.proxyUrl && (
        <label className="flex items-center gap-2 text-sm font-bold text-mute">
          <input type="checkbox" className="h-4 w-4 accent-brand" checked={clearProxy} onChange={(e) => setClearProxy(e.target.checked)} />
          Отключить прокси
        </label>
      )}
      <p className="text-sm font-semibold text-mute">Через прокси идёт только связь бота с Discord. Опрос игровых серверов всегда идёт напрямую.</p>

      <ErrorLine text={error} />
      {tokenSet && status?.inviteUrl && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-4 py-3">
          <InviteButton url={status.inviteUrl} />
          <span className="text-sm font-semibold text-mute">Откроется Discord: выберите сервер и подтвердите права.</span>
        </div>
      )}
      {saved && <p className="rounded-2xl bg-okbg px-4 py-2.5 font-bold text-ok" role="status">Сохранено. Бот переподключится в течение 10 секунд.</p>}
      <button className="btn" disabled={busy || (!token.trim() && !proxy.trim() && !clearProxy)}>Сохранить</button>
    </form>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setDone(false);
    try {
      await api('/auth/password', 'POST', { current, next });
      setDone(true);
      toast('Пароль изменён');
      setCurrent('');
      setNext('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="panel space-y-3.5 p-6">
      <h2 className="text-lg font-black">Пароль администратора</h2>
      <Field label="Текущий пароль">
        <input id="pw-current" className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </Field>
      <Field label="Новый пароль (от 10 символов)">
        <input id="pw-next" className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required />
      </Field>
      <ErrorLine text={error} />
      {done && <p className="rounded-2xl bg-okbg px-4 py-2.5 font-bold text-ok" role="status">Пароль изменён.</p>}
      <button className="btn">Сохранить пароль</button>
    </form>
  );
}

const short = (v: string | null) => (v ? v.slice(0, 7) : '–');

const DISMISS_KEY = 'coregsm_dismissed_update_error';
const readDismissed = (): number => {
  try { return Number(localStorage.getItem(DISMISS_KEY)) || 0; } catch { return 0; }
};
const rememberDismissed = (t: number) => {
  try { localStorage.setItem(DISMISS_KEY, String(t)); } catch { /* not remembered */ }
};

function UpdateCard() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // set when "Update" was pressed: remembers the previous job timestamp to recognise the new result
  const [waiting, setWaiting] = useState<{ since: number; baseTime: number | null } | null>(null);
  const [offline, setOffline] = useState(false);

  usePoll(() => {
    api<UpdateInfo>('/update/status')
      .then((r) => {
        setOffline(false);
        setInfo(r);
        if (!waiting || !r.job || r.job.time === waiting.baseTime) return;
        if (r.job.state === 'done') {
          setWaiting(null);
          // new frontend files are served now: reload to pick them up
          setTimeout(() => window.location.reload(), 1500);
        } else if (r.job.state === 'error') {
          setWaiting(null);
          setError(r.job.message);
        }
      })
      .catch(() => {
        // the backend restarts during an update
        if (waiting) setOffline(true);
      });
  }, waiting ? 3_000 : 30_000);

  const check = async () => {
    setBusy(true);
    setError('');
    try {
      setInfo(await api<UpdateInfo>('/update/check', 'POST'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!window.confirm('Обновить панель? Она будет недоступна 1-3 минуты, данные и настройки сохранятся.')) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<UpdateInfo>('/update/apply', 'POST');
      setInfo(r);
      setWaiting({ since: Date.now(), baseTime: r.job?.time ?? null });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const running = !!waiting || info?.job?.state === 'running';
  // an old failure matters only while an update is still pending; a manual install that succeeded makes it moot
  const [dismissed, setDismissed] = useState<number>(readDismissed);
  const showOldFailure = !running && !error && info?.job?.state === 'error' && !!info.available && info.job.time !== dismissed;
  const stuck = !!waiting && Date.now() - waiting.since > 60_000 && !!info?.pending;

  return (
    <div className="panel space-y-3.5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-black">Обновления</h2>
        {running ? <span className="pill pill-warn">ОБНОВЛЕНИЕ</span>
          : info?.available ? <span className="pill pill-warn">ДОСТУПНО ОБНОВЛЕНИЕ</span>
          : info?.latest ? <span className="pill pill-ok">ПОСЛЕДНЯЯ ВЕРСИЯ</span>
          : <span className="pill pill-mute">ПРОВЕРКА</span>}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm font-bold sm:max-w-sm">
        <div className="rounded-2xl bg-soft px-4 py-2.5"><dt className="text-mute">Установлена</dt><dd className="font-mono text-[15px]">{short(info?.current ?? null)}</dd></div>
        <div className="rounded-2xl bg-soft px-4 py-2.5"><dt className="text-mute">В репозитории</dt><dd className="font-mono text-[15px]">{short(info?.latest ?? null)}</dd></div>
      </dl>

      {running && (
        <p className="rounded-2xl bg-warnbg px-4 py-2.5 font-bold text-warn" role="status">
          {offline ? 'Панель перезапускается… страница обновится сама.' : info?.job?.state === 'running' ? info.job.message : 'Запрос отправлен серверу…'}
        </p>
      )}
      {stuck && (
        <p className="rounded-2xl bg-badbg px-4 py-2.5 text-sm font-bold text-bad">
          Сервер не взял запрос в работу. Проверьте на сервере: <span className="font-mono">systemctl status coregsm-update.path</span> или обновите командой <span className="font-mono">sudo coregsm update</span>.
        </p>
      )}
      {info?.error && !running && <p className="text-sm font-semibold text-mute">{info.error}</p>}
      {showOldFailure && info?.job && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-badbg px-4 py-2.5 text-sm font-bold text-bad">
          <span>Прошлая попытка обновления не удалась. {info.job.message}</span>
          <button type="button" className="underline" onClick={() => { rememberDismissed(info.job!.time); setDismissed(info.job!.time); }}>Скрыть</button>
        </div>
      )}
      <ErrorLine text={error} />

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-soft" onClick={check} disabled={busy || running}>Проверить обновления</button>
        {info?.available && <button className="btn" onClick={apply} disabled={busy || running || !info.canApply}>Обновить сейчас</button>}
      </div>
      {info && !info.canApply && <p className="text-sm font-semibold text-mute">Кнопка недоступна на этом сервере. Обновляйте командой <span className="font-mono">sudo coregsm update</span>.</p>}
    </div>
  );
}

function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[var(--brand,#5865f2)]" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-extrabold">{label}</span>
        <span className="block text-sm font-semibold text-mute">{hint}</span>
      </span>
    </label>
  );
}

export function UsersTab() {
  const { me, reload } = useAuth();
  const [access, setAccess] = useState<Access | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState('');

  const load = () => {
    api<Access>('/access').then(setAccess).catch((e) => setError(e.message));
    api<UserRow[]>('/users').then(setUsers).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const save = async (patch: Partial<Access>) => {
    await api<Access>('/access', 'PUT', patch).then((a) => { setAccess(a); void reload(); toast('Сохранено'); }).catch((e) => setError(e.message));
  };
  const setRole = async (u: UserRow, role: UserRow['role']) => {
    await api(`/users/${u.id}`, 'PUT', { role }).then(() => toast('Роль изменена')).catch((e) => setError(e.message));
    load();
  };
  const resetPassword = async (u: UserRow) => {
    const pw = window.prompt(`Новый пароль для «${u.username}» (от 8 символов):`);
    if (!pw) return;
    await api(`/users/${u.id}/password`, 'PUT', { password: pw }).then(() => toast('Пароль изменён')).catch((e) => setError(e.message));
  };
  const remove = async (u: UserRow) => {
    if (!window.confirm(`Удалить пользователя «${u.username}»?`)) return;
    await api(`/users/${u.id}`, 'DELETE').then(() => toast('Пользователь удалён')).catch((e) => setError(e.message));
    load();
  };

  return (
    <>
      <div className="panel space-y-4 p-6">
        <h2 className="text-lg font-black">Кто видит панель</h2>
        {access && (
          <>
            <Switch on={access.publicPanel} onChange={(v) => void save({ publicPanel: v })} label="Открыта для всех" hint="Серверы и новости видны без входа. Выключите, чтобы панель открывалась только после авторизации." />
            <Switch on={access.registration} onChange={(v) => void save({ registration: v })} label="Регистрация игроков" hint="Любой желающий может создать аккаунт игрока (без прав администратора)." />
          </>
        )}
        <p className="text-sm font-semibold text-mute">Игроки и гости только смотрят серверы и новости. Добавлять серверы, писать новости и менять настройки могут администраторы.</p>
      </div>

      <div className="panel space-y-3 p-6">
        <h2 className="text-lg font-black">Пользователи</h2>
        <ErrorLine text={error} />
        <ul className="divide-y divide-line">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <span className="min-w-0 flex-1 truncate font-bold">{u.username}{u.username === me?.username ? ' (вы)' : ''}</span>
              <select className="input !w-auto !py-1.5" value={u.role} onChange={(e) => void setRole(u, e.target.value as UserRow['role'])} aria-label={`Роль ${u.username}`}>
                <option value="player">Игрок</option>
                <option value="admin">Администратор</option>
              </select>
              <button className="btn btn-soft btn-sm" onClick={() => void resetPassword(u)}>Пароль</button>
              <button className="btn btn-danger btn-sm" onClick={() => void remove(u)} disabled={u.username === me?.username}>Удалить</button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
