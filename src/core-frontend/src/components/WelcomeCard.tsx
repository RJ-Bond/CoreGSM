import { useEffect, useState } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';
import { Button, Section, Switch, fail, toast } from '../ui';
import { ChannelName, ChannelPicker } from './ChannelPicker';

interface Welcome { enabled: boolean; channelId: string; text: string; defaultText: string; maxLength: number }

/** «Приветствие новичков»: the bot greets a new member of the Discord server and points to /register. */
export default function WelcomeCard() {
  useI18n();
  const [w, setW] = useState<Welcome | null>(null);
  const [text, setText] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<Welcome>('/settings/welcome').then((r) => { if (alive) { setW(r); setText(r.text); } }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!w) return null;

  const save = async (patch: Partial<Pick<Welcome, 'enabled' | 'channelId' | 'text'>>) => {
    setBusy(true);
    try {
      const r = await api<Welcome>('/settings/welcome', 'PUT', patch);
      setW(r);
      setText(r.text);
      toast(t('wl.saved'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('wl.title')}>
      <p className="mb-3 text-sm font-semibold text-mute">{t('wl.help')}</p>
      <label className="mb-3 flex items-center gap-3 font-bold">
        <Switch id="welcome-on" checked={w.enabled} onChange={(on) => void save({ enabled: on })} /> {t('wl.on')}
      </label>
      {w.enabled && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-black">{w.channelId ? <ChannelName id={w.channelId} /> : t('wl.noChannel')}</span>
            <button type="button" className="btn btn-soft btn-sm" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>{t('wl.pick')}</button>
          </div>
          {picking && <ChannelPicker id="welcome-channel" value={w.channelId} onChange={(v) => { if (/^\d{15,25}$/.test(v)) { void save({ channelId: v }); setPicking(false); } }} />}
          <div>
            <label htmlFor="welcome-text" className="label">{t('wl.text')}</label>
            <textarea id="welcome-text" className="input min-h-24" maxLength={w.maxLength} value={text} placeholder={w.defaultText} onChange={(e) => setText(e.target.value)} />
            <p className="mt-1 text-sm font-semibold text-mute">{t('wl.vars')}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" loading={busy} onClick={() => void save({ text })} disabled={text.trim() === w.text}>{t('common.save')}</Button>
            <span className="text-sm font-semibold text-mute">{t('wl.intent')}</span>
          </div>
        </div>
      )}
    </Section>
  );
}
