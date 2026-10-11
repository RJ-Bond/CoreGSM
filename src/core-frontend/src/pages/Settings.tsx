import { useState, type FormEvent } from 'react';
import { api, type BotStatus, type SettingsInfo } from '../api';
import { ErrorLine, Field, PageHead, usePoll } from '../ui';

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

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHead title="Настройки" subtitle="Discord-бот, прокси и доступ к панели" />
      <div className="grid items-start gap-5 md:grid-cols-2">
        <BotCard />
        <PasswordCard />
      </div>
      <p className="max-w-2xl font-semibold text-mute">
        Домен и порты задаются при установке и хранятся в <span className="font-mono text-[13px] text-ink">/app/.env</span>. Обновить панель до новой версии можно командой{' '}
        <span className="font-mono text-[13px] text-ink">sudo coregsm-update</span> на сервере.
      </p>
    </div>
  );
}

function BotCard() {
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [token, setTokenValue] = useState('');
  const [proxy, setProxy] = useState('');
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
      const body: { discordToken?: string; proxyUrl?: string } = {};
      if (token.trim()) body.discordToken = token.trim();
      if (clearProxy) body.proxyUrl = '';
      else if (proxy.trim()) body.proxyUrl = proxy.trim();
      const r = await api<SettingsInfo>('/settings', 'PUT', body);
      setInfo(r);
      setTokenValue('');
      setProxy('');
      setClearProxy(false);
      setSaved(true);
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
        <p className="rounded-2xl bg-badbg px-4 py-2.5 text-[13px] font-bold text-bad">{status.error}</p>
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
        <button type="button" className="text-[13px] font-extrabold text-bad hover:underline" onClick={removeToken}>Удалить сохранённый токен</button>
      )}

      <Field label="Прокси (необязательно)">
        <input
          id="set-proxy"
          className="input font-mono"
          value={clearProxy ? '' : proxy}
          disabled={clearProxy}
          onChange={(e) => setProxy(e.target.value)}
          autoComplete="off"
          placeholder={info?.proxyUrl ? `сейчас: ${info.proxyUrl}` : 'socks5://host:1080 или http://host:3128'}
        />
      </Field>
      {info?.proxyUrl && (
        <label className="flex items-center gap-2 text-[13px] font-bold text-mute">
          <input type="checkbox" className="h-4 w-4 accent-brand" checked={clearProxy} onChange={(e) => setClearProxy(e.target.checked)} />
          Отключить прокси
        </label>
      )}
      <p className="text-[13px] font-semibold text-mute">Через прокси идёт только связь бота с Discord. Опрос игровых серверов всегда идёт напрямую.</p>

      <ErrorLine text={error} />
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
