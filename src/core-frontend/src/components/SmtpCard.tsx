import { useEffect, useState, type FormEvent } from 'react';
import { api, type SmtpInfo } from '../api';
import { ErrorLine, Section, TextField, toast } from '../ui';

/** Settings → security: outgoing e-mail (password reset, address confirmation, new-device letters). Administrators only. */
export default function SmtpCard() {
  const [info, setInfo] = useState<SmtpInfo | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const apply = (s: SmtpInfo) => {
    setInfo(s);
    setHost(s.host);
    setPort(String(s.port));
    setSecure(s.secure);
    setUser(s.user);
    setFrom(s.from);
    setPassword('');
  };

  useEffect(() => {
    api<SmtpInfo>('/settings/smtp').then(apply).catch((e) => setError((e as Error).message));
  }, []);

  const portNum = Number(port);
  const portErr = port && (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) ? 'Порт от 1 до 65535' : '';

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || portErr) return;
    setError('');
    setNote('');
    setBusy(true);
    try {
      const body: Record<string, unknown> = { host: host.trim(), port: portNum || 587, secure, user: user.trim(), from: from.trim() };
      // empty = keep the saved password
      if (password) body.password = password;
      apply(await api<SmtpInfo>('/settings/smtp', 'PUT', body));
      toast('Настройки почты сохранены');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clearPassword = async () => {
    setError('');
    try {
      apply(await api<SmtpInfo>('/settings/smtp', 'PUT', { password: '' }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const test = async () => {
    setError('');
    setNote('');
    setTesting(true);
    try {
      await api('/settings/smtp/test', 'POST', { to: to.trim() });
      setNote(`Пробное письмо отправлено на ${to.trim()}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Section
      title="Почта (SMTP)"
      description="Нужна для сброса пароля, подтверждения адреса и писем о входе с нового устройства. Без неё эти функции выключены."
      actions={info && <span className={`pill ${info.ready ? 'pill-ok' : 'pill-mute'}`}>{info.ready ? 'ПОЧТА РАБОТАЕТ' : 'НЕ НАСТРОЕНА'}</span>}
    >
      <form onSubmit={save} className="space-y-3.5">
        <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <TextField id="smtp-host" label="Сервер SMTP" value={host} onChange={setHost} placeholder="smtp.example.com" autoComplete="off" />
          <TextField id="smtp-port" label="Порт" value={port} onChange={setPort} inputMode="numeric" error={portErr} autoComplete="off" />
        </div>
        <label className="flex cursor-pointer items-center gap-2.5 font-bold text-mute">
          <input type="checkbox" className="h-4 w-4 accent-brand" checked={secure} onChange={(e) => { setSecure(e.target.checked); if (e.target.checked && port === '587') setPort('465'); if (!e.target.checked && port === '465') setPort('587'); }} />
          Шифрование с первого байта (SSL/TLS, обычно порт 465). Иначе используется STARTTLS.
        </label>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <TextField id="smtp-user" label="Логин" value={user} onChange={setUser} autoComplete="off" />
          <TextField
            id="smtp-pass"
            label={info?.passwordSet ? 'Пароль (сохранён, оставьте пустым чтобы не менять)' : 'Пароль'}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
        </div>
        <TextField id="smtp-from" label="Адрес отправителя" value={from} onChange={setFrom} placeholder="CoreGSM <no-reply@example.com>" autoComplete="off" />
        {info && !info.publicBase && (
          <p className="rounded-2xl bg-warnbg px-4 py-2.5 text-sm font-bold text-warn">
            Публичный адрес панели неизвестен: письма со ссылками для сброса пароля не будут отправляться. Откройте панель по домену под администратором или задайте PUBLIC_URL в .env.
          </p>
        )}
        <ErrorLine text={error} />
        {note && <p className="rounded-ui-lg bg-okbg px-4 py-2.5 font-bold text-ok" role="status">{note}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" disabled={busy || !!portErr}>Сохранить</button>
          {info?.passwordSet && <button type="button" className="btn-soft" onClick={() => void clearPassword()}>Удалить пароль</button>}
        </div>
      </form>

      <div className="space-y-2 border-t pt-4">
        <TextField id="smtp-to" label="Отправить пробное письмо на" value={to} onChange={setTo} type="email" placeholder="you@example.com" autoComplete="email" />
        <button type="button" className="btn-soft" disabled={testing || !to.trim() || !info?.ready} onClick={() => void test()}>
          {testing ? 'Отправляю…' : 'Отправить пробное письмо'}
        </button>
      </div>
    </Section>
  );
}
