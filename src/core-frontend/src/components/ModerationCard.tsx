import { useEffect, useState } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';
import { Button, Section, Switch, fail, toast } from '../ui';
import { ChannelName, ChannelPicker } from './ChannelPicker';

interface Channel { id: string; name: string; guild: string }
interface Moderation { enabled: boolean; punish: boolean; logChannelId: string; protectedChannels: string[]; cooldown: number; channels: Channel[]; maxProtected: number; maxCooldown: number }

/**
 * «Модерация»: settings of the /clear command of the bot: switch it off, protect channels from cleaning, the pause between
 * two cleanings of one channel and the channel that receives a record of each cleaning.
 */
export default function ModerationCard() {
  useI18n();
  const [m, setM] = useState<Moderation | null>(null);
  const [cool, setCool] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<Moderation>('/settings/moderation').then((r) => { if (alive) { setM(r); setCool(String(r.cooldown)); } }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!m) return null;

  const save = async (patch: Partial<Pick<Moderation, 'enabled' | 'punish' | 'logChannelId' | 'protectedChannels' | 'cooldown'>>) => {
    setBusy(true);
    try {
      const r = await api<Moderation>('/settings/moderation', 'PUT', patch);
      setM(r);
      setCool(String(r.cooldown));
      toast(t('mod.saved'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const coolNum = Number(cool);
  const coolOk = cool.trim() !== '' && Number.isInteger(coolNum) && coolNum >= 0 && coolNum <= m.maxCooldown;
  const multi = new Set(m.channels.map((c) => c.guild)).size > 1;

  return (
    <Section title={t('mod.title')}>
      <p className="mb-3 text-sm font-semibold text-mute">{t('mod.help')}</p>
      <label className="mb-3 flex items-center gap-3 font-bold">
        <Switch id="clear-on" checked={m.enabled} onChange={(on) => void save({ enabled: on })} /> {t('mod.on')}
      </label>
      <label className="mb-3 flex items-center gap-3 font-bold">
        <Switch id="punish-on" checked={m.punish} onChange={(on) => void save({ punish: on })} /> {t('mod.punish')}
      </label>
      <p className="-mt-1 mb-3 text-sm font-semibold text-mute">{t('mod.punishHelp')}</p>
      {(m.enabled || m.punish) && (
        <div className="space-y-4">
          <div>
            <span className="label">{t('mod.log')}</span>
            <p className="mb-2 text-sm font-semibold text-mute">{t('mod.logHelp')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-black">{m.logChannelId ? <ChannelName id={m.logChannelId} /> : t('mod.noLog')}</span>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>{t('mod.pick')}</button>
              {m.logChannelId && <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => void save({ logChannelId: '' })}>{t('mod.clearLog')}</button>}
            </div>
            {picking && <div className="mt-2"><ChannelPicker id="clear-log-channel" value={m.logChannelId} onChange={(v) => { if (/^\d{15,25}$/.test(v)) { void save({ logChannelId: v }); setPicking(false); } }} /></div>}
          </div>
          <div>
            <label htmlFor="clear-cooldown" className="label">{t('mod.cooldown')}</label>
            <p className="mb-2 text-sm font-semibold text-mute">{t('mod.cooldownHelp')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <input id="clear-cooldown" type="number" min={0} max={m.maxCooldown} step={1} className="input w-28" value={cool} onChange={(e) => setCool(e.target.value)} />
              <Button type="button" loading={busy} onClick={() => void save({ cooldown: coolNum })} disabled={!coolOk || coolNum === m.cooldown}>{t('common.save')}</Button>
            </div>
          </div>
          <div>
            <span className="label">{t('mod.protected')}</span>
            <p className="mb-2 text-sm font-semibold text-mute">{t('mod.protectedHelp', { n: m.maxProtected })}</p>
            {m.channels.length === 0 ? (
              <p className="text-sm font-semibold text-mute">{t('mod.noChannels')}</p>
            ) : (
              <div className="flex flex-wrap gap-2" role="group" aria-label={t('mod.protected')}>
                {m.channels.map((c) => {
                  const on = m.protectedChannels.includes(c.id);
                  const full = !on && m.protectedChannels.length >= m.maxProtected;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`chip-filter ${on ? 'on' : ''}`}
                      aria-pressed={on}
                      disabled={busy || full}
                      onClick={() => void save({ protectedChannels: on ? m.protectedChannels.filter((x) => x !== c.id) : [...m.protectedChannels, c.id] })}
                    >
                      <span aria-hidden="true" className="mr-1.5">{on ? '🛡️' : '#'}</span>
                      {c.name}{multi ? ` · ${c.guild}` : ''}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <p className="text-sm font-semibold text-mute">{t('mod.perms')}</p>
        </div>
      )}
    </Section>
  );
}
