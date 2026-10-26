/**
 * Admin → Оповещения: channels that do not depend on Discord (an outgoing webhook, e-mail to administrators).
 * If the bot or its token is gone, these still tell the administrator that a server is down.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import { Button, ErrorLine, Field, IconTrash, Modal, Section, Switch, ago, toast } from '../ui';

export interface AlertChannel {
  id: number;
  kind: 'webhook' | 'email';
  name: string;
  urlPreview: string;
  hasSecret: boolean;
  recipients: string[];
  events: string[];
  enabled: boolean;
  allowPrivate: boolean;
  lastStatus: 'ok' | 'error' | null;
  lastError: string | null;
  lastAt: number | null;
}
interface ChannelsInfo { smtpReady: boolean; events: { id: string; label: string }[]; items: AlertChannel[] }

/** the sentence under a channel: where it goes */
export function channelTarget(c: Pick<AlertChannel, 'kind' | 'urlPreview' | 'recipients'>): string {
  return c.kind === 'webhook' ? c.urlPreview : c.recipients.join(', ');
}

/** the state of the last delivery in words */
export function channelState(c: Pick<AlertChannel, 'enabled' | 'lastStatus' | 'lastError' | 'lastAt'>): { text: string; tone: 'ok' | 'bad' | 'mute' } {
  if (!c.enabled) return { text: t('ach.stOff'), tone: 'mute' };
  if (c.lastStatus === 'ok') return { text: t('ach.stOk', { ago: ago(c.lastAt) }), tone: 'ok' };
  if (c.lastStatus === 'error') return { text: t('ach.stErr', { ago: ago(c.lastAt), e: c.lastError ?? t('ach.stUnknown') }), tone: 'bad' };
  return { text: t('ach.stNever'), tone: 'mute' };
}

export default function AlertChannels() {
  useI18n();
  const [info, setInfo] = useState<ChannelsInfo | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<AlertChannel | 'new-webhook' | 'new-email' | null>(null);
  const [testing, setTesting] = useState<number | null>(null);

  const load = () => api<ChannelsInfo>('/alert-channels').then((r) => { setInfo(r); setError(''); }).catch((e: Error) => { if (/404/.test(e.message) || /не найден/i.test(e.message)) setGone(true); else setError(e.message); });
  useEffect(() => { void load(); }, []);

  const test = async (c: AlertChannel) => {
    setTesting(c.id);
    await api<ChannelsInfo & { ok: boolean; error: string | null }>(`/alert-channels/${c.id}/test`, 'POST')
      .then((r) => { setInfo(r); if (r.ok) toast(t('ach.testDone')); else setError(r.error ?? t('ach.testFail')); if (r.ok) setError(''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setTesting(null));
  };
  const toggle = async (c: AlertChannel, enabled: boolean) => {
    await api<ChannelsInfo>(`/alert-channels/${c.id}`, 'PUT', { kind: c.kind, name: c.name, events: c.events, enabled })
      .then((r) => { setInfo(r); setError(''); })
      .catch((e: Error) => setError(e.message));
  };
  const remove = async (c: AlertChannel) => {
    if (!(await confirmDialog({ title: t('ach.deleteTitle', { name: c.name }), text: t('ach.deleteText'), confirmLabel: t('ach.delete'), danger: true }))) return;
    await api<ChannelsInfo>(`/alert-channels/${c.id}`, 'DELETE').then((r) => { setInfo(r); setError(''); }).catch((e: Error) => setError(e.message));
  };

  if (gone) return null;
  const labels = new Map(info?.events.map((e) => [e.id, e.label]));

  return (
    <Section
      title={t('ach.title')}
      description={t('ach.desc')}
      actions={(
        <>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => setEdit('new-webhook')}>{t('ach.addHook')}</button>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => setEdit('new-email')}>{t('ach.addMail')}</button>
        </>
      )}
    >
      <ErrorLine text={error} />
      {!info && !error && <div className="skeleton h-14 rounded-ui-lg" aria-busy="true" aria-label={t('ach.loading')} />}
      {info && !info.smtpReady && <p className="text-sm font-semibold text-mute">{t('ach.smtpOff')}</p>}
      {info && info.items.length === 0 && <p className="text-sm font-semibold text-mute">{t('ach.none')}</p>}
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {info?.items.map((c) => {
          const st = channelState(c);
          return (
            <li key={c.id} className="flex flex-wrap items-start gap-3 rounded-2xl bg-soft px-3 py-2.5">
              <Switch className="mt-1" checked={c.enabled} aria-label={t('ach.on', { name: c.name })} onChange={(on) => void toggle(c, on)} />
              <div className="min-w-0 flex-1">
                <div className="font-extrabold">{c.kind === 'webhook' ? t('ach.kindHook') : t('ach.kindMail')}: {c.name}</div>
                <div className="truncate text-sm font-semibold text-mute" title={channelTarget(c)}>{channelTarget(c)}{c.kind === 'webhook' && t(c.hasSecret ? 'ach.secretSet' : 'ach.secretNone')}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {c.events.length === 0 && <span className="pill pill-mute">{t('ach.noEvents')}</span>}
                  {c.events.map((e) => <span key={e} className="pill pill-mute">{labels.get(e) ?? e}</span>)}
                </div>
                <div className={`mt-1 text-sm font-bold ${st.tone === 'ok' ? 'text-ok' : st.tone === 'bad' ? 'text-bad' : 'text-mute'}`}>{st.text}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button className="btn-soft btn-sm" loading={testing === c.id} onClick={() => void test(c)}>{t('ach.test')}</Button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(c)}>{t('ach.change')}</button>
                <button type="button" className="row-act row-act-danger" aria-label={t('ach.deleteAria', { name: c.name })} title={t('ach.delete')} onClick={() => void remove(c)}><IconTrash /></button>
              </div>
            </li>
          );
        })}
      </ul>
      {edit && info && (
        <ChannelForm
          events={info.events}
          smtpReady={info.smtpReady}
          channel={typeof edit === 'object' ? edit : null}
          kind={typeof edit === 'object' ? edit.kind : edit === 'new-email' ? 'email' : 'webhook'}
          onClose={() => setEdit(null)}
          onSaved={(r) => { setInfo(r); setEdit(null); setError(''); toast(t('ach.saved')); }}
        />
      )}
    </Section>
  );
}

function ChannelForm({ channel, kind, events, smtpReady, onClose, onSaved }: {
  channel: AlertChannel | null;
  kind: 'webhook' | 'email';
  events: { id: string; label: string }[];
  smtpReady: boolean;
  onClose: () => void;
  onSaved: (r: ChannelsInfo) => void;
}) {
  useI18n();
  const [name, setName] = useState(channel?.name ?? '');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [rcpt, setRcpt] = useState(channel?.recipients.join(', ') ?? '');
  const [on, setOn] = useState<string[]>(channel?.events ?? (kind === 'webhook' ? ['server_down', 'server_up'] : ['server_down', 'bot_down']));
  const [allowPrivate, setAllowPrivate] = useState(channel?.allowPrivate ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body: Record<string, unknown> = { kind, name: name.trim(), events: on };
    if (kind === 'webhook') {
      if (url.trim()) body.url = url.trim();
      if (clearSecret) body.secret = null;
      else if (secret.trim()) body.secret = secret.trim();
      body.allowPrivate = allowPrivate;
    } else body.recipients = rcpt;
    await (channel ? api<ChannelsInfo>(`/alert-channels/${channel.id}`, 'PUT', body) : api<ChannelsInfo>('/alert-channels', 'POST', body))
      .then(onSaved)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <Modal title={t(channel ? (kind === 'webhook' ? 'ach.formHook' : 'ach.formMail') : (kind === 'webhook' ? 'ach.formNewHook' : 'ach.formNewMail'))} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3.5">
        <Field label={t('ach.name')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder={t(kind === 'webhook' ? 'ach.nameHookPh' : 'ach.nameMailPh')} /></Field>
        {kind === 'webhook' ? (
          <>
            <Field label={channel ? t('ach.urlKeep', { now: channel.urlPreview }) : t('ach.url')}>
              <input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} required={!channel} placeholder="https://example.com/hooks/coregsm" autoComplete="off" />
            </Field>
            <Field label={t(channel?.hasSecret ? 'ach.secretHave' : 'ach.secretNew')}>
              <input className="input" type="password" value={secret} onChange={(e) => { setSecret(e.target.value); setClearSecret(false); }} maxLength={200} autoComplete="new-password" disabled={clearSecret} />
            </Field>
            {channel?.hasSecret && (
              <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={clearSecret} onChange={(e) => setClearSecret(e.target.checked)} /> {t('ach.secretClear')}</label>
            )}
            <p className="text-sm font-semibold text-mute">
              {t('ach.sigHelp')}
            </p>
            <label className="flex items-start gap-3 font-bold">
              <Switch className="mt-0.5" checked={allowPrivate} onChange={setAllowPrivate} />
              <span>
                {t('ach.private')}
                <span className="block text-sm font-semibold text-mute">{t('ach.privateText')}</span>
              </span>
            </label>
          </>
        ) : (
          <>
            <Field label={t('ach.rcpt')}><input className="input" value={rcpt} onChange={(e) => setRcpt(e.target.value)} required placeholder="admin@example.com, ops@example.com" /></Field>
            {!smtpReady && <p className="text-sm font-semibold text-warn">{t('ach.smtpWarn')}</p>}
          </>
        )}
        <fieldset>
          <legend className="label">{t('ach.events')}</legend>
          <div className="grid gap-1.5 min-[480px]:grid-cols-2">
            {events.map((ev) => (
              <label key={ev.id} className="flex items-center gap-2 font-bold">
                <input type="checkbox" checked={on.includes(ev.id)} onChange={(e) => setOn((cur) => (e.target.checked ? [...cur, ev.id] : cur.filter((x) => x !== ev.id)))} />
                {ev.label}
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('ach.cancel')}</button>
          <Button loading={busy}>{t('ach.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}
