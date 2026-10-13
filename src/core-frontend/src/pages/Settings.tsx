import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { onAccentChange, paintBrand } from '../accent';
import { parseHex } from '../colors';
import { AccentPicker } from '../components/AccentPicker';
import { api, getToken, type Access, type BotStatus, type Changelog, type SettingsInfo, type UpdateInfo, type UserRow } from '../api';
import { confirmDialog, promptDialog } from '../confirm';
import { useAuth } from '../auth';
import { Switch as ToggleSwitch } from '../components/Switch';
import { AdminPage, CopyButton, ErrorLine, Field, FieldError, GoLink, IconArrowUp, IconCheck, IconKey, IconSettings, IconTrash, IconUsers, Logo, InviteButton, PageHead, ProxyField, SaveBadge, Section, Spinner, TextField, ago, plural, toast, useAutosave, usePoll, type ProxyType } from '../ui';
import BackupsCard from './Backups';
import SmtpCard from '../components/SmtpCard';
import { SETTINGS_TABS } from './adminNav';
import PollSettingsCard from '../components/PollSettingsCard';

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

/** готовые темы: основной цвет и конец градиента */
const THEME_PRESETS = [
  { id: 'indigo', name: 'Индиго', c1: '#4f46e5', c2: '#3730a3' },
  { id: 'emerald', name: 'Изумруд', c1: '#059669', c2: '#047857' },
  { id: 'sunset', name: 'Закат', c1: '#ea580c', c2: '#be185d' },
  { id: 'ocean', name: 'Океан', c1: '#0284c7', c2: '#1d4ed8' },
  { id: 'fuchsia', name: 'Фуксия', c1: '#c026d3', c2: '#7e22ce' },
  { id: 'graphite', name: 'Графит', c1: '#475569', c2: '#0f172a' },
] as const;

/** название, цвет и логотип сообщества: изменения сохраняются сами */
function BrandCard() {
  const { access, reload } = useAuth();
  const b = access.brand;
  const [name, setName] = useState(b.name);
  const [color, setColor] = useState(b.color);
  const [color2, setColor2] = useState(b.color2 ?? '');
  const [preset, setPreset] = useState(b.preset ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const swatches = ['#4f46e5', '#7c3aed', '#db2777', '#e11d48', '#ea580c', '#16a34a', '#0891b2', '#2563eb'];
  const savedRef = useRef(b);
  savedRef.current = b;

  const pickColor = (c: string) => { setColor(c); setColor2(''); setPreset(''); };
  const pickPreset = (p: (typeof THEME_PRESETS)[number]) => { setColor(p.c1); setColor2(p.c2); setPreset(p.id); };

  // live preview of the chosen colours across the whole panel (a game accent chosen in «Внешний вид» still wins, see accent.ts)
  useEffect(() => {
    paintBrand(color, color2 || undefined);
    const root = document.documentElement;
    const mo = new MutationObserver(() => paintBrand(color, color2 || undefined));
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    const off = onAccentChange(() => paintBrand(color, color2 || undefined));
    return () => {
      mo.disconnect();
      off();
      paintBrand(savedRef.current.color, savedRef.current.color2 || undefined);
    };
  }, [color, color2]);

  // name and colours are saved as you go: on a pause, on leaving the name field, on picking a colour
  const form = { name, color, color2, preset };
  const savedForm = { name: b.name, color: b.color, color2: b.color2 ?? '', preset: b.preset ?? '' };
  const nameError = !name.trim() ? 'Введите название сообщества' : name.trim().length > 32 ? 'Не длиннее 32 символов' : '';
  const colorError = parseHex(color) ? '' : 'Цвет должен быть в формате #RRGGBB';
  const auto = useAutosave({
    value: form,
    saved: savedForm,
    delay: 800,
    validate: (f) => (!f.name.trim() ? 'Введите название сообщества' : f.name.trim().length > 32 ? 'Не длиннее 32 символов' : parseHex(f.color) ? null : 'Цвет должен быть в формате #RRGGBB'),
    save: async (f) => {
      await api('/branding', 'PUT', { name: f.name.trim(), color: f.color, color2: f.color2, preset: f.preset });
      await reload();
    },
  });

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
    <Section
      title="Оформление"
      description="Название, цвет и логотип вашего сообщества. Они видны в панели, на странице входа и в подвале сообщений Discord. Изменения сохраняются сами."
      actions={<SaveBadge status={auto.status} error={auto.error} retry={auto.retry} />}
      data-tour="brand"
    >
      <TextField
        id="brand-name"
        label="Название"
        value={name}
        maxLength={32}
        onChange={setName}
        error={nameError && name !== b.name ? nameError : undefined}
        onBlur={auto.flush}
        hint={`${name.trim().length} / 32`}
      />
      <div>
        <span className="label">Тема</span>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {THEME_PRESETS.map((p) => {
            const on = preset === p.id;
            return (
              <button type="button" key={p.id} onClick={() => pickPreset(p)} aria-pressed={on} className={`rounded-ui-lg border bg-card p-2 text-left ${on ? 'border-transparent ring-2 ring-ink ring-offset-2 ring-offset-card' : 'border-line hover:shadow-1'}`}>
                <span className="block h-12 rounded-ui-md" style={{ background: `linear-gradient(135deg, ${p.c1}, ${p.c2})` }} />
                <span className="mt-1.5 block px-0.5 text-sm font-extrabold">{p.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <span className="label">Свой цвет</span>
        <div className="flex flex-wrap items-center gap-2">
          {swatches.map((c) => (
            <button type="button" key={c} onClick={() => pickColor(c)} aria-label={c} aria-pressed={!preset && color === c} className={`h-9 w-9 rounded-full ring-offset-2 ring-offset-card ${!preset && color === c ? 'ring-2 ring-ink' : ''}`} style={{ background: c }} />
          ))}
          <input type="color" value={parseHex(color) ? color : '#4f46e5'} onChange={(e) => pickColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded-ui-sm border border-line bg-card" aria-label="Свой цвет" />
        </div>
        <FieldError id="brand-color-err" text={colorError} />
      </div>
      <div>
        <span className="label">Как это выглядит</span>
        <div className="flex flex-wrap items-center gap-4 rounded-ui-lg border border-line bg-soft p-4">
          <Logo size={44} />
          <div className="min-w-0">
            <div className="truncate text-base font-black">{name.trim() || 'CoreGSM'}</div>
            <div className="text-sm font-semibold text-mute">Мониторинг игровых серверов</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="btn pointer-events-none" aria-hidden>Кнопка</span>
            <span className="grid h-9 w-9 place-items-center rounded-ui-md bg-gradient-to-br from-brand to-brand-2 text-white shadow-1" aria-hidden>
              <IconCheck size={18} />
            </span>
          </div>
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
      <div className="border-t border-line pt-4">
        <AccentPicker />
      </div>
    </Section>
  );
}

// the ids stay the canonical hashes (#/admin/settings/bot|brand|security|updates); only the labels are friendlier
const TABS = SETTINGS_TABS;

const TAB_HINT: Record<string, { hint: string; help: ReactNode }> = {
  bot: {
    hint: 'Здесь вы подключаете Discord-бота: он публикует сообщения и новости. Токен берётся в Discord Developer Portal.',
    help: (
      <>
        <p>Как получить токен:</p>
        <ol>
          <li>Откройте discord.com/developers, раздел Applications, и создайте приложение.</li>
          <li>На вкладке Bot нажмите Reset Token и скопируйте токен.</li>
          <li>Вставьте его ниже и сохраните, затем нажмите «Пригласить бота на сервер».</li>
        </ol>
        <p>Прокси нужен только если Discord недоступен с вашего сервера.</p>
      </>
    ),
  },
  brand: {
    hint: 'Название, цвет и логотип сообщества: их видят все посетители панели и участники в подвале сообщений Discord.',
    help: <p>Готовые темы меняют цвета всей панели сразу. Изменения применяются и сохраняются сами; пока идёт сохранение или если оно не удалось, цвета видны только вам как предпросмотр. «Акцент по игре» действует только в вашем браузере.</p>,
  },
  security: {
    hint: 'Пароль администратора и сведения о доступе: кто может входить в панель и регистрироваться.',
    help: <p>Пароль нужно менять, если им делились. Переключатели регистрации и правила сообщества находятся в разделе «Пользователи».</p>,
  },
  updates: {
    hint: 'Установка новых версий панели и резервные копии данных. Перед обновлением сохраняется копия базы, поэтому его можно откатить.',
    help: <p>Копия содержит серверы, привязки, пользователей, новости и токен бота, поэтому храните файлы бережно. Автоматические копии включаются расписанием ниже.</p>,
  },
};

export default function SettingsPage({ sub, updateAvailable }: { sub: string; updateAvailable: boolean }) {
  const tab = TABS.some((t) => t.id === sub) ? sub : 'bot';
  return (
    <AdminPage
      narrow
      head={<PageHead key={tab} icon={<IconSettings />} title="Настройки" subtitle="Бот, оформление, безопасность, обновления и копии" hint={TAB_HINT[tab].hint} help={TAB_HINT[tab].help} />}
    >
      <nav className="flex w-full max-w-2xl gap-1 overflow-x-auto rounded-full bg-soft p-1" aria-label="Разделы настроек">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`#/admin/settings/${t.id}`}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`flex-1 whitespace-nowrap rounded-full px-4 py-1.5 text-center font-extrabold transition ${tab === t.id ? 'bg-brand text-white shadow-1' : 'text-mute hover:text-ink'}`}
          >
            {t.label}
            {t.id === 'updates' && updateAvailable && <span className="update-dot ml-1.5 align-middle" title="Доступно обновление" />}
          </a>
        ))}
      </nav>
      {tab === 'bot' && <><BotCard /><PollSettingsCard /></>}
      {tab === 'brand' && <BrandCard />}
      {tab === 'security' && (
        <>
          <PasswordCard />
          <SmtpCard />
          <Section title="Вход и доступ">
            <p className="font-semibold text-mute">Кто может открыть панель, регистрироваться и какие у людей роли, настраивается в разделе «Пользователи».</p>
            <p className="font-semibold text-mute">Список ваших входов с устройств и выход со всех остальных находится в профиле.</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <GoLink href="#/admin/users">Пользователи и доступ</GoLink>
              <GoLink href="#/profile">Мои сеансы в профиле</GoLink>
            </div>
          </Section>
          <p className="font-semibold text-mute">
            Домен и порты задаются при установке и хранятся в <span className="font-mono text-sm text-ink">/app/.env</span>. Изменить их можно командой <span className="font-mono text-sm text-ink">sudo coregsm</span> на сервере (пункт «Домен и прокси»).
          </p>
        </>
      )}
      {tab === 'updates' && (
        <>
          <UpdateCard />
          <BackupsCard />
        </>
      )}
    </AdminPage>
  );
}

function BotCard() {
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [token, setTokenValue] = useState('');
  const [proxy, setProxy] = useState('');
  const [proxyType, setProxyType] = useState<ProxyType>('socks5');
  const [clearProxy, setClearProxy] = useState(false);
  const [secret, setSecret] = useState('');
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
      const body: { discordToken?: string; discordClientSecret?: string; proxyUrl?: string; proxyType?: ProxyType } = {};
      if (token.trim()) body.discordToken = token.trim();
      if (secret.trim()) body.discordClientSecret = secret.trim();
      if (clearProxy) body.proxyUrl = '';
      else if (proxy.trim()) { body.proxyUrl = proxy.trim(); body.proxyType = proxyType; }
      const r = await api<SettingsInfo>('/settings', 'PUT', body);
      setInfo(r);
      setTokenValue('');
      setSecret('');
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
    if (!(await confirmDialog({ title: 'Удалить токен?', text: 'Бот перестанет обновлять карточки.', confirmLabel: 'Удалить', danger: true }))) return;
    try {
      setInfo(await api<SettingsInfo>('/settings', 'PUT', { discordToken: '' }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removeSecret = async () => {
    if (!(await confirmDialog({ title: 'Удалить Client Secret?', text: 'Вход через Discord перестанет работать.', confirmLabel: 'Удалить', danger: true }))) return;
    try {
      setInfo(await api<SettingsInfo>('/settings', 'PUT', { discordClientSecret: '' }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const tokenSet = !!info?.discordTokenSet;
  const secretSet = !!info?.discordSecretSet;
  // checked while typing; the message appears under the field, the button waits until it is fixed
  const tokenWarn = token.trim() && !/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(token.trim()) ? 'Похоже, это не токен бота: он состоит из трёх частей через точки. Скопируйте его целиком в Developer Portal (Bot → Reset Token).' : '';
  const proxyWarn = proxy.trim() && !clearProxy && !/^([a-z0-9]+:\/\/)?[^\s:@/]+(:[^\s@/]+)*(@[^\s:@/]+(:\d{1,5})?)?$/i.test(proxy.trim()) ? 'Формат: адрес:порт:логин:пароль или socks5://логин:пароль@адрес:порт' : '';

  return (
    <Section title="Бот и вход через Discord" actions={<BotPill status={status} tokenSet={tokenSet} />}>
    <form onSubmit={save} className="space-y-3.5">
      {tokenSet && status?.state === 'error' && status.error && (
        <p className="rounded-2xl bg-badbg px-4 py-2.5 text-sm font-bold text-bad">{status.error}</p>
      )}

      <div data-tour="bot-token">
      <Field label="Токен бота">
        <input
          id="set-token"
          className="input font-mono"
          type="password"
          value={token}
          onChange={(e) => setTokenValue(e.target.value)}
          autoComplete="off"
          placeholder={tokenSet ? `сохранён (${info?.discordTokenHint}), введите новый для замены` : 'вставьте токен из Developer Portal'}
          aria-invalid={tokenWarn ? true : undefined}
          aria-describedby={tokenWarn ? 'set-token-err' : undefined}
        />
      </Field>
      <FieldError id="set-token-err" text={tokenWarn} />
      </div>
      {tokenSet && (
        <button type="button" className="btn-link-danger text-sm" onClick={removeToken}>Удалить сохранённый токен</button>
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
      <FieldError id="set-proxy-err" text={proxyWarn} />
      {info?.proxyUrl && (
        <label className="flex items-center gap-2 text-sm font-bold text-mute">
          <input type="checkbox" className="h-4 w-4 accent-brand" checked={clearProxy} onChange={(e) => setClearProxy(e.target.checked)} />
          Отключить прокси
        </label>
      )}
      <p className="text-sm font-semibold text-mute">Через прокси идёт только связь бота с Discord. Опрос игровых серверов всегда идёт напрямую.</p>

      <div className="space-y-3 rounded-ui-lg bg-soft p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-black">Вход через Discord</h3>
          <span className={`pill ${secretSet ? 'pill-ok' : 'pill-mute'}`}>{secretSet ? 'ВКЛЮЧЁН' : 'НЕ НАСТРОЕН'}</span>
        </div>
        <Field label="Client Secret">
          <input
            id="set-secret"
            className="input font-mono"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
            placeholder={secretSet ? 'сохранён, введите новый для замены' : 'не задан'}
          />
        </Field>
        {secretSet && (
          <button type="button" className="btn-link-danger text-sm" onClick={() => void removeSecret()}>Удалить Client Secret</button>
        )}
        {info?.discordRedirect && (
          <div>
            <label htmlFor="set-redirect" className="label">Redirect URI</label>
            <div className="flex gap-2">
              <input id="set-redirect" className="input font-mono" readOnly value={info.discordRedirect} onFocus={(e) => e.currentTarget.select()} />
              <CopyButton text={info.discordRedirect} className="shrink-0" />
            </div>
          </div>
        )}
        <p className="text-sm font-semibold text-mute">
          Добавьте этот адрес в Developer Portal: OAuth2 → Redirects. Client Secret скопируйте на той же странице OAuth2.
        </p>
      </div>

      <ErrorLine text={error} />
      {tokenSet && status?.inviteUrl && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-4 py-3">
          <InviteButton url={status.inviteUrl} />
          <span className="text-sm font-semibold text-mute">Откроется Discord: выберите сервер и подтвердите права.</span>
        </div>
      )}
      {saved && <p className="rounded-2xl bg-okbg px-4 py-2.5 font-bold text-ok" role="status">Сохранено. Бот переподключится в течение 10 секунд.</p>}
      <p className="text-sm font-semibold text-mute">Токен, Client Secret и прокси сохраняются только кнопкой: это секреты, их не отправляем «на лету».</p>
      <button className="btn" disabled={busy || (!token.trim() && !secret.trim() && !proxy.trim() && !clearProxy)}>Сохранить</button>
    </form>
    </Section>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // validated while typing (the server checks again)
  const nextError = next && next.length < 10 ? `Ещё ${10 - next.length} ${plural(10 - next.length, ['символ', 'символа', 'символов'])}: нужно от 10` : next && next === current ? 'Новый пароль совпадает с текущим' : '';
  const ready = !!current && next.length >= 10 && !nextError;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setError('');
    setDone(false);
    setBusy(true);
    try {
      await api('/auth/password', 'POST', { current, next });
      setDone(true);
      toast('Пароль изменён');
      setCurrent('');
      setNext('');
    } catch (err) {
      // the typed values stay in the form: nothing is lost, only the message appears
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Пароль администратора">
      <form onSubmit={submit} className="space-y-3.5">
        <TextField id="pw-current" label="Текущий пароль" type="password" value={current} onChange={(v) => { setCurrent(v); setError(''); }} autoComplete="current-password" />
        <TextField id="pw-next" label="Новый пароль (от 10 символов)" type="password" value={next} onChange={setNext} autoComplete="new-password" error={nextError} />
        <ErrorLine text={error} />
        {done && <p className="rounded-ui-lg bg-okbg px-4 py-2.5 font-bold text-ok" role="status">Пароль изменён.</p>}
        <button className="btn" disabled={!ready || busy}>Сохранить пароль</button>
      </form>
    </Section>
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
  // set when "Update" or "Rollback" was pressed: remembers the previous job timestamp to recognise the new result
  const [waiting, setWaiting] = useState<{ since: number; baseTime: number | null; kind: 'update' | 'rollback' } | null>(null);
  const [offline, setOffline] = useState(false);
  const [log, setLog] = useState<Changelog | null>(null);
  const [logError, setLogError] = useState('');

  useEffect(() => {
    api<Changelog>('/update/changelog')
      .then((r) => { setLog(r); setLogError(r.error ?? ''); })
      .catch((e: Error) => setLogError(e.message));
  }, []);

  // percent of the running job: only grows while the same job runs (never goes backwards between polls)
  const [pct, setPct] = useState<number | null>(null);
  const pctJob = useRef<number | null>(null);
  const [finished, setFinished] = useState<'update' | 'rollback' | null>(null);
  const running = !!waiting || info?.job?.state === 'running';

  usePoll(() => {
    api<UpdateInfo>('/update/status')
      .then((r) => {
        setOffline(false);
        setInfo(r);
        const j = r.job;
        const current = !!j && (j.state === 'running' || (!!waiting && j.time !== waiting.baseTime));
        if (j && current && typeof j.progress === 'number') {
          const p = Math.max(0, Math.min(100, Math.round(j.progress)));
          if (pctJob.current !== j.time) { pctJob.current = j.time; setPct(p); } else setPct((c) => Math.max(c ?? 0, p));
        }
        if (!waiting || !j || j.time === waiting.baseTime) return;
        if (j.state === 'done') {
          setFinished(waiting.kind);
          setPct(100);
          setWaiting(null);
          // new frontend files are served now: reload to pick them up
          setTimeout(() => window.location.reload(), 1500);
        } else if (j.state === 'error') {
          setWaiting(null);
          setError(j.message);
        }
      })
      .catch(() => {
        // the backend restarts during an update
        if (waiting || info?.job?.state === 'running') setOffline(true);
      });
  }, running && !finished ? 2_000 : 30_000);

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
    if (!(await confirmDialog({ title: 'Обновить панель?', text: 'Она будет недоступна 1-3 минуты, данные и настройки сохранятся.', confirmLabel: 'Обновить' }))) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<UpdateInfo>('/update/apply', 'POST');
      setInfo(r);
      setPct(null);
      setFinished(null);
      setWaiting({ since: Date.now(), baseTime: r.job?.time ?? null, kind: 'update' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rollback = async () => {
    const ok = await confirmDialog({
      title: 'Откатить к предыдущей версии?',
      text: 'Будут восстановлены предыдущая версия панели и копия базы данных, сделанная перед последним обновлением. Всё, что изменилось после обновления (новые серверы, новости, пользователи), будет потеряно. Панель будет недоступна 1-3 минуты.',
      confirmLabel: 'Откатить',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<UpdateInfo>('/update/rollback', 'POST');
      setInfo(r);
      setPct(null);
      setFinished(null);
      setWaiting({ since: Date.now(), baseTime: r.job?.time ?? null, kind: 'rollback' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rollingBack = (waiting?.kind ?? finished) === 'rollback';
  // an old failure matters only while an update is still pending; a manual install that succeeded makes it moot
  const [dismissed, setDismissed] = useState<number>(readDismissed);
  const showOldFailure = !running && !error && info?.job?.state === 'error' && !!info.available && info.job.time !== dismissed;
  const stuck = !!waiting && Date.now() - waiting.since > 60_000 && !!info?.pending;

  const state: 'running' | 'available' | 'latest' | 'unknown' = running || finished ? 'running' : info?.available ? 'available' : info?.latest ? 'latest' : 'unknown';
  const lastChecked = info?.checkedAt ?? null;

  return (
    <div className="space-y-5">
      <section
        aria-live="polite"
        className={`relative overflow-hidden rounded-[26px] p-6 sm:p-7 ${
          state === 'available'
            ? 'update-hero text-white'
            : state === 'running'
              ? 'update-hero update-hero-run text-white'
              : 'panel'
        }`}
      >
        {(state === 'available' || state === 'running') && <span aria-hidden className="pointer-events-none absolute -right-14 -top-14 h-56 w-56 rounded-full bg-white/15" />}
        <div className="relative flex flex-wrap items-start gap-4">
          <span
            aria-hidden
            className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${
              state === 'available' || state === 'running' ? 'bg-white/20 text-white' : state === 'latest' ? 'bg-okbg text-ok' : 'bg-soft text-mute'
            }`}
          >
            {state === 'latest' ? (
              <IconCheck size={30} />
            ) : state === 'running' ? (
              <Spinner className="h-7 w-7" />
            ) : (
              <IconArrowUp size={30} className={state === 'available' ? 'update-bob' : ''} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-extrabold leading-tight" style={{ letterSpacing: '-0.02em' }}>
              {state === 'running' ? (rollingBack ? 'Откат к предыдущей версии' : 'Идёт обновление')
                : state === 'available' ? 'Доступно обновление'
                : state === 'latest' ? 'Установлена последняя версия'
                : 'Проверка обновлений'}
            </h2>
            <p className={`mt-1 font-semibold ${state === 'available' || state === 'running' ? 'text-white/90' : 'text-mute'}`}>
              {state === 'running'
                ? (finished ? 'Готово! Панель обновится сама' : offline ? 'Панель перезапускается…' : info?.job?.state === 'running' && info.job.message ? info.job.message : rollingBack ? 'Откат к предыдущей версии…' : 'Запрос отправлен серверу…')
                : state === 'available'
                  ? 'Новая сборка уже в репозитории. Данные и настройки сохранятся, панель будет недоступна 1-3 минуты.'
                  : state === 'latest'
                    ? `Всё свежее${lastChecked ? `, проверено ${ago(lastChecked)}` : ''}.`
                    : 'Узнаём, есть ли новая версия…'}
            </p>

            <dl className="mt-4 flex flex-wrap items-center gap-2 text-sm font-bold">
              <div className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 ${state === 'available' || state === 'running' ? 'bg-white/20' : 'bg-soft'}`}>
                <dt className={state === 'available' || state === 'running' ? 'text-white/85' : 'text-mute'}>Установлена</dt>
                <dd className="font-mono">{short(info?.current ?? null)}</dd>
              </div>
              {state === 'available' && <span aria-hidden className="text-lg font-black text-white/90">→</span>}
              <div className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 ${state === 'available' ? 'bg-white text-ink' : state === 'running' ? 'bg-white/20' : 'bg-soft'}`}>
                <dt className={state === 'available' ? 'text-mute' : state === 'running' ? 'text-white/85' : 'text-mute'}>В репозитории</dt>
                <dd className="font-mono">{short(info?.latest ?? null)}</dd>
              </div>
            </dl>
          </div>
        </div>

        {state === 'running' && (
          <div className="relative mt-5 flex items-center gap-3">
            <div
              className={`update-progress min-w-0 flex-1 ${pct != null ? 'det' : ''}`}
              role="progressbar"
              aria-label={rollingBack ? 'Ход отката' : 'Ход обновления'}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct ?? undefined}
            >
              <i style={pct != null ? ({ '--p': `${pct}%` } as CSSProperties) : undefined} />
            </div>
            {pct != null && <span className="w-14 shrink-0 text-right text-lg font-black tabular-nums" aria-hidden>{pct} %</span>}
            {finished && (
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-okbg text-ok" aria-hidden>
                <IconCheck size={16} />
              </span>
            )}
          </div>
        )}

        <div className="relative mt-5 flex flex-wrap items-center gap-2.5">
          {state === 'available' && (
            <>
              <button className="btn-on-grad btn-lg" onClick={apply} disabled={busy || running || !info?.canApply}>
                {busy ? 'Отправляю…' : 'Обновить сейчас'}
              </button>
              <a className="btn-ghost-on-grad" href="#update-changes" onClick={(e) => { e.preventDefault(); document.getElementById('update-changes')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Что нового</a>
            </>
          )}
          {(state === 'latest' || state === 'unknown') && (
            <button className="btn" onClick={check} disabled={busy || running}>{busy ? 'Проверяю…' : 'Проверить обновления'}</button>
          )}
          {state === 'available' && (
            <button className="btn-ghost-on-grad" onClick={check} disabled={busy || running}>Проверить ещё раз</button>
          )}
          {info?.canRollback && state !== 'running' && (
            <button className={`${state === 'available' ? 'btn-ghost-on-grad' : 'btn btn-soft'} sm:ml-auto`} onClick={() => void rollback()} disabled={busy || running}>Откатить к предыдущей</button>
          )}
        </div>

        {state === 'available' && info && !info.canApply && (
          <p className="relative mt-3 rounded-2xl bg-black/15 px-4 py-2.5 text-sm font-bold">
            Кнопка недоступна на этом сервере. Обновляйте командой <span className="font-mono">sudo coregsm update</span>.
          </p>
        )}
        {state !== 'available' && info && !info.canApply && state !== 'running' && (
          <p className="relative mt-3 text-sm font-semibold text-mute">Кнопка обновления недоступна на этом сервере. Обновляйте командой <span className="font-mono">sudo coregsm update</span>.</p>
        )}
        {stuck && (
          <p className="relative mt-3 rounded-2xl bg-badbg px-4 py-2.5 text-sm font-bold text-bad">
            Сервер не взял запрос в работу. Проверьте на сервере: <span className="font-mono">systemctl status coregsm-update.path</span> или {rollingBack ? 'выполните откат вручную' : <>обновите командой <span className="font-mono">sudo coregsm update</span></>}.
          </p>
        )}
        {info?.error && !running && <p className="relative mt-3 text-sm font-semibold text-mute">{info.error}</p>}
        {showOldFailure && info?.job && (
          <div className="relative mt-3 flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-badbg px-4 py-2.5 text-sm font-bold text-bad">
            <span>Прошлая попытка обновления не удалась. {info.job.message}</span>
            <button type="button" className="btn-link btn-link-tone" onClick={() => { rememberDismissed(info.job!.time); setDismissed(info.job!.time); }}>Скрыть</button>
          </div>
        )}
        <div className="relative"><ErrorLine text={error} /></div>
      </section>

      <Section id="update-changes" title="Что нового" className="scroll-mt-24">

        {!log && !logError && <div className="skeleton h-24 rounded-2xl" />}
        {logError && <p className="text-sm font-semibold text-mute">Не удалось получить список изменений: {logError}</p>}
        {log && log.items.length === 0 && !logError && <p className="font-semibold text-mute">Список изменений пуст.</p>}
        {log && log.items.length > 0 && (
          <ul className="divide-y divide-line">
            {log.items.map((c) => (
              <li key={c.sha} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5">
                <a href={/^https?:\/\//i.test(c.url) ? c.url : undefined} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 basis-60 break-words font-bold hover:text-link">{c.title}</a>
                <span className="font-mono text-sm font-semibold text-mute">{c.sha.slice(0, 7)}</span>
                <span className="text-sm font-semibold text-mute">{ago(typeof c.date === 'number' ? c.date : Date.parse(String(c.date)) || null)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <ToggleSwitch className="mt-0.5" checked={on} onChange={onChange} />
      <span>
        <span className="block font-extrabold">{label}</span>
        <span className="block text-sm font-semibold text-mute">{hint}</span>
      </span>
    </label>
  );
}

const ROLE_LABEL: Record<UserRow['role'], string> = { player: 'Игрок', moderator: 'Модератор', admin: 'Администратор' };

export function UsersTab() {
  const { me, reload } = useAuth();
  const [access, setAccess] = useState<Access | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState('');
  const [rules, setRules] = useState('');
  const rulesInit = useRef(false);

  const load = () => {
    api<Access>('/access').then((a) => {
      setAccess(a);
      // the text is taken from the server once: a later reload must not replace what is being typed
      if (!rulesInit.current) { rulesInit.current = true; setRules(a.rules ?? ''); }
    }).catch((e) => setError(e.message));
    api<UserRow[]>('/users').then(setUsers).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const save = async (patch: Partial<Access>) => {
    await api<Access>('/access', 'PUT', patch).then((a) => { setAccess(a); void reload(); toast('Сохранено'); }).catch((e) => setError(e.message));
  };
  const approve = async (u: UserRow) => {
    await api(`/users/${u.id}/approve`, 'POST').then(() => toast(`«${u.username}» одобрен`)).catch((e) => setError(e.message));
    load();
  };
  const reject = async (u: UserRow) => {
    if (!(await confirmDialog({ title: `Отклонить заявку «${u.username}»?`, confirmLabel: 'Отклонить', danger: true }))) return;
    await api(`/users/${u.id}`, 'DELETE').then(() => toast('Заявка отклонена')).catch((e) => setError(e.message));
    load();
  };
  // the rules text is saved as you type (after a pause and on leaving the field); the text is never replaced under the cursor
  const rulesAuto = useAutosave({
    value: rules,
    saved: access?.rules ?? '',
    enabled: !!access,
    delay: 1200,
    equal: (a, b) => a.trim() === b.trim(),
    validate: (v) => (v.length > 5000 ? 'Не больше 5000 символов' : null),
    save: async (v) => {
      const a = await api<Access>('/access', 'PUT', { rules: v.trim() });
      setAccess(a);
      void reload();
    },
  });
  const setRole = async (u: UserRow, role: UserRow['role']) => {
    await api(`/users/${u.id}`, 'PUT', { role }).then(() => toast('Роль изменена')).catch((e) => setError(e.message));
    load();
  };
  const resetPassword = async (u: UserRow) => {
    const pw = await promptDialog({
      title: `Новый пароль для «${u.username}»`,
      label: 'Новый пароль (от 8 символов)',
      password: true,
      confirmLabel: 'Сменить пароль',
      validate: (v) => (v.length < 8 ? 'Минимум 8 символов' : null),
    });
    if (!pw) return;
    await api(`/users/${u.id}/password`, 'PUT', { password: pw }).then(() => toast('Пароль изменён')).catch((e) => setError(e.message));
  };
  const remove = async (u: UserRow) => {
    if (!(await confirmDialog({ title: `Удалить пользователя «${u.username}»?`, confirmLabel: 'Удалить', danger: true }))) return;
    await api(`/users/${u.id}`, 'DELETE').then(() => toast('Пользователь удалён')).catch((e) => setError(e.message));
    load();
  };

  const pendingUsers = users.filter((u) => u.status === 'pending');

  return (
    <AdminPage
      head={(
        <PageHead
          icon={<IconUsers />}
          title="Пользователи"
          subtitle="Аккаунты, роли, регистрация и правила"
          hint="Здесь решается, кто может открывать панель, регистрироваться и что кому разрешено. Роль определяет права человека."
          help={<p>Игрок только смотрит серверы и новости. Модератор ещё и пишет новости. Администратор управляет всем. Все действия администраторов попадают в журнал.</p>}
        >
          <a className="btn btn-soft" href="#/admin/journal">Журнал: кто что менял</a>
        </PageHead>
      )}
    >
      <Section title="Кто видит панель">
        {access && (
          <>
            <Switch on={access.publicPanel} onChange={(v) => void save({ publicPanel: v })} label="Открыта для всех" hint="Серверы и новости видны без входа. Выключите, чтобы панель открывалась только после авторизации." />
            <Switch on={access.registration} onChange={(v) => void save({ registration: v })} label="Регистрация игроков" hint="Любой желающий может создать аккаунт игрока (без прав администратора)." />
            <div className="pl-8">
              <label htmlFor="reg-mode" className="label">Режим регистрации</label>
              <select id="reg-mode" className="input !w-auto max-w-full" value={access.registrationMode} disabled={!access.registration} onChange={(e) => void save({ registrationMode: e.target.value as Access['registrationMode'] })}>
                <option value="open">Открытая: сразу</option>
                <option value="approval">По заявке: после одобрения администратором</option>
              </select>
            </div>
          </>
        )}
        <p className="text-sm font-semibold text-mute">Игроки и гости только смотрят серверы и новости. Добавлять серверы и менять настройки могут администраторы.</p>
        <div className="rounded-ui-lg bg-soft px-4 py-3 text-sm font-semibold text-mute">
          <p><b className="text-ink">Игрок</b>: смотрит серверы и новости, ведёт свой профиль.</p>
          <p><b className="text-ink">Модератор</b>: пишет, публикует и удаляет новости, меняет канал новостей по умолчанию. Серверы, настройки, пользователи и система ему недоступны.</p>
          <p><b className="text-ink">Администратор</b>: полный доступ ко всему.</p>
        </div>
      </Section>

      <Section
        title="Правила сообщества"
        description="Если текст задан, при регистрации нужно подтвердить согласие с ним. Оставьте пустым, чтобы правил не было. Текст сохраняется сам."
        actions={<SaveBadge status={rulesAuto.status} error={rulesAuto.error} retry={rulesAuto.retry} />}
      >
        <TextField
          id="rules"
          label="Текст правил"
          multiline
          rows={6}
          maxLength={5000}
          value={rules}
          onChange={setRules}
          onBlur={rulesAuto.flush}
          error={rulesAuto.invalid ? rulesAuto.error : undefined}
          placeholder="1. Уважайте других игроков…"
          hint={`${rules.length} / 5000`}
          className="min-h-32"
        />
      </Section>

      {pendingUsers.length > 0 && (
        <Section title="Заявки на регистрацию">
          <ul className="divide-y divide-line">
            {pendingUsers.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="min-w-0 flex-1 truncate font-bold">{u.username}{u.discordName ? ` · Discord: ${u.discordName}` : ''}</span>
                <button className="btn btn-sm" onClick={() => void approve(u)}>Одобрить</button>
                <button className="btn btn-danger btn-sm" onClick={() => void reject(u)}>Отклонить</button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Пользователи">
        <ErrorLine text={error} />
        <ul className="divide-y divide-line">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <span className="min-w-0 flex-1 truncate font-bold">
                {u.username}{u.username === me?.username ? ' (вы)' : ''}
                {u.discordName && <span className="ml-2 text-sm font-semibold text-mute">Discord: {u.discordName}</span>}
              </span>
              {u.status === 'pending' && <span className="pill pill-warn">ЗАЯВКА</span>}
              <span className={`pill ${u.role === 'admin' ? 'pill-bad' : u.role === 'moderator' ? 'pill-warn' : 'pill-mute'}`}>{ROLE_LABEL[u.role].toUpperCase()}</span>
              <select className="input !w-auto !py-1.5" value={u.role} onChange={(e) => void setRole(u, e.target.value as UserRow['role'])} aria-label={`Роль ${u.username}`}>
                <option value="player">Игрок</option>
                <option value="moderator">Модератор</option>
                <option value="admin">Администратор</option>
              </select>
              <button type="button" className="row-act" title="Сменить пароль" aria-label={`Сменить пароль: ${u.username}`} onClick={() => void resetPassword(u)}><IconKey /></button>
              <button type="button" className="row-act row-act-danger" title="Удалить" aria-label={`Удалить: ${u.username}`} onClick={() => void remove(u)} disabled={u.username === me?.username}><IconTrash /></button>
            </li>
          ))}
        </ul>
        <p className="text-sm font-semibold text-mute">Пароль самого администратора меняется в <GoLink href="#/admin/settings/security">Настройки: Безопасность</GoLink>.</p>
      </Section>
    </AdminPage>
  );
}
