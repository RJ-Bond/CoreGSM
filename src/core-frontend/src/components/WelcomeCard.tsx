import { useEffect, useState } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';
import { Button, Section, Switch, fail, toast } from '../ui';
import { ChannelName, ChannelPicker } from './ChannelPicker';

interface Role { id: string; name: string; color: number }
interface Welcome { enabled: boolean; channelId: string; text: string; embed: boolean; roles: string[]; availableRoles: Role[]; defaultText: string; maxLength: number; maxRoles: number }

const roleDot = (color: number) => (color ? `#${color.toString(16).padStart(6, '0')}` : 'rgb(var(--mute))');

/**
 * «Приветствие новичков»: the bot greets a new member of the Discord server (a funny line at random, or the administrator's
 * own ones), in a beautiful embed, and offers a menu of roles to take.
 */
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

  const save = async (patch: Partial<Pick<Welcome, 'enabled' | 'channelId' | 'text' | 'embed' | 'roles'>>) => {
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
          <label className="flex items-center gap-3 font-bold">
            <Switch id="welcome-embed" checked={w.embed} onChange={(on) => void save({ embed: on })} /> {t('wl.embed')}
          </label>
          <p className="-mt-1 text-sm font-semibold text-mute">{t('wl.embedHint')}</p>
          <div>
            <span className="label">{t('wl.roles')}</span>
            <p className="mb-2 text-sm font-semibold text-mute">{t('wl.rolesHelp', { n: w.maxRoles })}</p>
            {w.availableRoles.length === 0 ? (
              <p className="text-sm font-semibold text-mute">{w.channelId ? t('wl.noRoles') : t('wl.rolesNoChannel')}</p>
            ) : (
              <div className="flex flex-wrap gap-2" role="group" aria-label={t('wl.roles')}>
                {w.availableRoles.map((r) => {
                  const on = w.roles.includes(r.id);
                  const full = !on && w.roles.length >= w.maxRoles;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={`chip-filter ${on ? 'on' : ''}`}
                      aria-pressed={on}
                      disabled={busy || full}
                      onClick={() => void save({ roles: on ? w.roles.filter((x) => x !== r.id) : [...w.roles, r.id] })}
                    >
                      <span aria-hidden="true" className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: roleDot(r.color) }} />
                      {r.name}
                    </button>
                  );
                })}
              </div>
            )}
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
