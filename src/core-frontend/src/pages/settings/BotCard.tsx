/** Settings → Bot: Discord token, proxy, Discord sign-in, invite link and the bot's state. */
import { type FormEvent, useState } from 'react';
import { api, type BotStatus, type SettingsInfo } from '../../api';
import { confirmDialog } from '../../confirm';
import { t, useI18n } from '../../i18n';
import { CopyButton, ErrorLine, Field, FieldError, InviteButton, noAutofill, ProxyField, type ProxyType, Section, toast, usePoll, errText } from '../../ui';

export function BotPill({ status, tokenSet }: { status: BotStatus | null; tokenSet: boolean }) {
  useI18n();
  if (!tokenSet) return <span className="pill pill-mute">{t('d2.bot.p.noToken')}</span>;
  if (!status) return <span className="pill pill-mute">{t('d2.bot.p.checking')}</span>;
  switch (status.state) {
    case 'online':
      // logged in to Discord, but it is on no server (kicked or never invited): nothing can be posted
      if (typeof status.guildCount === 'number' && status.guildCount === 0) return <span className="pill pill-warn">{t('d2.bot.p.noGuilds')}{status.tag ? ` · ${status.tag}` : ''}</span>;
      return <span className="pill pill-ok">{t('d2.bot.p.connected')}{status.tag ? ` · ${status.tag}` : ''}</span>;
    case 'connecting': return <span className="pill pill-warn">{t('d2.bot.p.connecting')}</span>;
    case 'error': return <span className="pill pill-bad">{t('d2.bot.p.error')}</span>;
    default: return <span className="pill pill-mute">{t('d2.bot.p.idle')}</span>;
  }
}

/** Gateway latency of the bot: the last hours as a line, and a warning when commands are likely to time out (Discord waits 3 s). */
function BotLatency({ status }: { status: BotStatus }) {
  useI18n();
  const pts = status.latency ?? [];
  if (status.state !== 'online' || status.ping == null) return null;
  const verdict = status.pingVerdict ?? 'ok';
  const max = Math.max(500, ...pts.map((p) => p.ms));
  const w = 240, h = 40;
  const d = pts.length > 1 ? pts.map((p, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * w).toFixed(1)} ${(h - (p.ms / max) * (h - 4) - 2).toFixed(1)}`).join(' ') : '';
  const tone = verdict === 'bad' ? 'text-bad' : verdict === 'slow' ? 'text-warn' : 'text-ok';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-soft px-4 py-2.5">
      <div>
        <div className="text-xs font-bold text-mute">{t('d2.bot.lat')}</div>
        <div className={`text-lg font-extrabold tabular-nums ${tone}`}>{t('d2.bot.ms', { n: status.ping })}</div>
      </div>
      {d && (
        <svg viewBox={`0 0 ${w} ${h}`} className={`h-10 min-w-0 flex-1 basis-40 ${tone}`} role="img" aria-label={t('d2.bot.latLabel', { n: status.ping })} preserveAspectRatio="none">
          <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {verdict !== 'ok' && verdict !== 'unknown' && (
        <p className={`basis-full text-sm font-bold ${tone}`}>
          {verdict === 'bad' ? t('d2.bot.slowBad') : t('d2.bot.slow')}
        </p>
      )}
    </div>
  );
}

export function BotCard() {
  useI18n();
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
      toast(t('d2.bot.t.saved'));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const removeToken = async () => {
    if (!(await confirmDialog({ title: t('d2.bot.c.tokenTitle'), text: t('d2.bot.c.tokenText'), confirmLabel: t('d2.news.delete'), danger: true }))) return;
    try {
      setInfo(await api<SettingsInfo>('/settings', 'PUT', { discordToken: '' }));
    } catch (err) {
      setError(errText(err));
    }
  };

  const removeSecret = async () => {
    if (!(await confirmDialog({ title: t('d2.bot.c.secretTitle'), text: t('d2.bot.c.secretText'), confirmLabel: t('d2.news.delete'), danger: true }))) return;
    try {
      setInfo(await api<SettingsInfo>('/settings', 'PUT', { discordClientSecret: '' }));
    } catch (err) {
      setError(errText(err));
    }
  };

  const tokenSet = !!info?.discordTokenSet;
  const secretSet = !!info?.discordSecretSet;
  // checked while typing; the message appears under the field, the button waits until it is fixed
  const tokenWarn = token.trim() && !/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(token.trim()) ? t('d2.bot.tokenWarn') : '';
  const proxyWarn = proxy.trim() && !clearProxy && !/^([a-z0-9]+:\/\/)?[^\s:@/]+(:[^\s@/]+)*(@[^\s:@/]+(:\d{1,5})?)?$/i.test(proxy.trim()) ? t('d2.bot.proxyWarn') : '';

  return (
    <Section title={t('d2.bot.title')} actions={<BotPill status={status} tokenSet={tokenSet} />}>
    <form onSubmit={save} className="space-y-3.5">
      {tokenSet && status?.state === 'error' && status.error && (
        <p className="rounded-2xl bg-badbg px-4 py-2.5 text-sm font-bold text-bad">{status.error}</p>
      )}

      {tokenSet && status && <BotLatency status={status} />}

      <div data-tour="bot-token">
      <Field label={t('d2.bot.token')}>
        <input
          id="set-token"
          className="input font-mono"
          type="password"
          value={token}
          onChange={(e) => setTokenValue(e.target.value)}
          {...noAutofill(true)}
          placeholder={tokenSet ? t('d2.bot.tokenSaved', { hint: info?.discordTokenHint ?? '' }) : t('d2.bot.tokenPaste')}
          aria-invalid={tokenWarn ? true : undefined}
          aria-describedby={tokenWarn ? 'set-token-err' : undefined}
        />
      </Field>
      <FieldError id="set-token-err" text={tokenWarn} />
      </div>
      {tokenSet && (
        <button type="button" className="btn-link-danger text-sm" onClick={removeToken}>{t('d2.bot.removeToken')}</button>
      )}

      <Field label={t('d2.bot.proxy')}>
        <ProxyField
          id="set-proxy"
          value={clearProxy ? '' : proxy}
          type={proxyType}
          onChange={setProxy}
          onType={setProxyType}
          disabled={clearProxy}
          placeholder={info?.proxyUrl ? t('d2.bot.proxyNow', { url: info.proxyUrl }) : undefined}
        />
      </Field>
      <FieldError id="set-proxy-err" text={proxyWarn} />
      {info?.proxyUrl && (
        <label className="flex items-center gap-2 text-sm font-bold text-mute">
          <input type="checkbox" className="h-4 w-4 accent-brand" checked={clearProxy} onChange={(e) => setClearProxy(e.target.checked)} />
          {t('d2.bot.proxyOff')}
        </label>
      )}
      <p className="text-sm font-semibold text-mute">{t('d2.bot.proxyNote')}</p>

      <div className="space-y-3 rounded-ui-lg bg-soft p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-black">{t('d2.bot.login')}</h3>
          <span className={`pill ${secretSet ? 'pill-ok' : 'pill-mute'}`}>{secretSet ? t('d2.bot.on') : t('d2.bot.notSet')}</span>
        </div>
        <Field label="Client Secret">
          <input
            id="set-secret"
            className="input font-mono"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            {...noAutofill(true)}
            placeholder={secretSet ? t('d2.bot.secretSaved') : t('d2.bot.secretNone')}
          />
        </Field>
        {secretSet && (
          <button type="button" className="btn-link-danger text-sm" onClick={() => void removeSecret()}>{t('d2.bot.removeSecret')}</button>
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
          {t('d2.bot.redirectNote')}
        </p>
      </div>

      <ErrorLine text={error} />
      {tokenSet && status?.inviteUrl && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-4 py-3">
          <InviteButton url={status.inviteUrl} />
          <span className="text-sm font-semibold text-mute">{t('d2.bot.inviteNote')}</span>
        </div>
      )}
      {saved && <p className="rounded-2xl bg-okbg px-4 py-2.5 font-bold text-ok" role="status">{t('d2.bot.savedNote')}</p>}
      <p className="text-sm font-semibold text-mute">{t('d2.bot.secretsNote')}</p>
      <button className="btn" disabled={busy || !!tokenWarn || !!proxyWarn || (!token.trim() && !secret.trim() && !proxy.trim() && !clearProxy)}>{t('common.save')}</button>
    </form>
    </Section>
  );
}
