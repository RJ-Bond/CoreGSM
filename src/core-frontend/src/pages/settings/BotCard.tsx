/** Settings → Bot: Discord token, proxy, Discord sign-in, invite link and the bot's state. */
import { type FormEvent, useState } from 'react';
import { api, type BotStatus, type SettingsInfo } from '../../api';
import { confirmDialog } from '../../confirm';
import { CopyButton, ErrorLine, Field, FieldError, InviteButton, noAutofill, ProxyField, type ProxyType, Section, toast, usePoll } from '../../ui';

export function BotPill({ status, tokenSet }: { status: BotStatus | null; tokenSet: boolean }) {
  if (!tokenSet) return <span className="pill pill-mute">ТОКЕН НЕ ЗАДАН</span>;
  if (!status) return <span className="pill pill-mute">ПРОВЕРКА</span>;
  switch (status.state) {
    case 'online':
      // logged in to Discord, but it is on no server (kicked or never invited): nothing can be posted
      if (typeof status.guildCount === 'number' && status.guildCount === 0) return <span className="pill pill-warn">НЕТ НА СЕРВЕРАХ{status.tag ? ` · ${status.tag}` : ''}</span>;
      return <span className="pill pill-ok">ПОДКЛЮЧЁН{status.tag ? ` · ${status.tag}` : ''}</span>;
    case 'connecting': return <span className="pill pill-warn">ПОДКЛЮЧАЕТСЯ</span>;
    case 'error': return <span className="pill pill-bad">ОШИБКА</span>;
    default: return <span className="pill pill-mute">ОЖИДАНИЕ</span>;
  }
}

export function BotCard() {
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
          {...noAutofill(true)}
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
            {...noAutofill(true)}
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
      <button className="btn" disabled={busy || !!tokenWarn || !!proxyWarn || (!token.trim() && !secret.trim() && !proxy.trim() && !clearProxy)}>Сохранить</button>
    </form>
    </Section>
  );
}
