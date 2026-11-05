import { useEffect, useState } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';
import { Button, Section, Switch, fail, toast } from '../ui';
import { ChannelName, ChannelPicker } from './ChannelPicker';

interface Channel { id: string; name: string; guild: string }
interface Moderation {
  enabled: boolean; punish: boolean; logChannelId: string; appealChannelId: string; protectedChannels: string[]; cooldown: number;
  warnTtlDays: number; muteAt: number; muteMinutes: number; kickAt: number; reasons: string[];
  channels: Channel[];
  maxProtected: number; maxCooldown: number; maxWarnTtlDays: number; maxLadder: number; maxMuteMinutes: number; maxReasons: number; maxReasonLen: number;
}
type Patch = Partial<Pick<Moderation, 'enabled' | 'punish' | 'logChannelId' | 'appealChannelId' | 'protectedChannels' | 'cooldown' | 'warnTtlDays' | 'muteAt' | 'muteMinutes' | 'kickAt' | 'reasons'>>;

const inRange = (s: string, max: number, min = 0) => s.trim() !== '' && Number.isInteger(Number(s)) && Number(s) >= min && Number(s) <= max;

/**
 * «Модерация»: settings of the moderation commands of the bot: /clear (switch, pause between cleanings, protected channels),
 * /ban /kick /warn /mute (switch, the lifetime of a warning, the ladder: a mute or a kick after so many warnings, the reasons
 * offered while typing), and the channels for the log and for the appeals of the banned.
 */
export default function ModerationCard() {
  useI18n();
  const [m, setM] = useState<Moderation | null>(null);
  const [cool, setCool] = useState('');
  const [ttl, setTtl] = useState('');
  const [muteAt, setMuteAt] = useState('');
  const [muteMin, setMuteMin] = useState('');
  const [kickAt, setKickAt] = useState('');
  const [reasons, setReasons] = useState('');
  const [picking, setPicking] = useState<'' | 'log' | 'appeal'>('');
  const [busy, setBusy] = useState(false);

  const load = (r: Moderation) => {
    setM(r);
    setCool(String(r.cooldown));
    setTtl(String(r.warnTtlDays));
    setMuteAt(String(r.muteAt));
    setMuteMin(String(r.muteMinutes));
    setKickAt(String(r.kickAt));
    setReasons(r.reasons.join('\n'));
  };

  useEffect(() => {
    let alive = true;
    api<Moderation>('/settings/moderation').then((r) => { if (alive) load(r); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!m) return null;

  const save = async (patch: Patch) => {
    setBusy(true);
    try {
      load(await api<Moderation>('/settings/moderation', 'PUT', patch));
      toast(t('mod.saved'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const multi = new Set(m.channels.map((c) => c.guild)).size > 1;
  const coolOk = inRange(cool, m.maxCooldown);
  const warnOk = inRange(ttl, m.maxWarnTtlDays) && inRange(muteAt, m.maxLadder) && inRange(muteMin, m.maxMuteMinutes, 1) && inRange(kickAt, m.maxLadder);
  const warnSame = Number(ttl) === m.warnTtlDays && Number(muteAt) === m.muteAt && Number(muteMin) === m.muteMinutes && Number(kickAt) === m.kickAt;
  const reasonList = reasons.split('\n').map((x) => x.trim()).filter(Boolean);
  const reasonsSame = reasonList.join('\n') === m.reasons.join('\n');

  const channelRow = (kind: 'log' | 'appeal', id: string, label: string, help: string, none: string, pickId: string, patch: (v: string) => Patch) => (
    <div>
      <span className="label">{label}</span>
      <p className="mb-2 text-sm font-semibold text-mute">{help}</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-black">{id ? <ChannelName id={id} /> : none}</span>
        <button type="button" className="btn btn-soft btn-sm" onClick={() => setPicking(picking === kind ? '' : kind)} aria-expanded={picking === kind}>{t('mod.pick')}</button>
        {id && <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => void save(patch(''))}>{t('mod.clearLog')}</button>}
      </div>
      {picking === kind && <div className="mt-2"><ChannelPicker id={pickId} value={id} onChange={(v) => { if (/^\d{15,25}$/.test(v)) { void save(patch(v)); setPicking(''); } }} /></div>}
    </div>
  );

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
        <div className="space-y-5">
          {channelRow('log', m.logChannelId, t('mod.log'), t('mod.logHelp'), t('mod.noLog'), 'clear-log-channel', (v) => ({ logChannelId: v }))}
          {m.punish && channelRow('appeal', m.appealChannelId, t('mod.appeal'), t('mod.appealHelp'), t('mod.noAppeal'), 'appeal-channel', (v) => ({ appealChannelId: v }))}
          {m.punish && (
            <div>
              <span className="label">{t('mod.warnTitle')}</span>
              <p className="mb-2 text-sm font-semibold text-mute">{t('mod.warnHelp')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="warn-ttl" className="label">{t('mod.ttl')}</label>
                  <input id="warn-ttl" type="number" min={0} max={m.maxWarnTtlDays} className="input" value={ttl} onChange={(e) => setTtl(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="warn-mute-at" className="label">{t('mod.muteAt')}</label>
                  <input id="warn-mute-at" type="number" min={0} max={m.maxLadder} className="input" value={muteAt} onChange={(e) => setMuteAt(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="warn-mute-min" className="label">{t('mod.muteMin')}</label>
                  <input id="warn-mute-min" type="number" min={1} max={m.maxMuteMinutes} className="input" value={muteMin} onChange={(e) => setMuteMin(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="warn-kick-at" className="label">{t('mod.kickAt')}</label>
                  <input id="warn-kick-at" type="number" min={0} max={m.maxLadder} className="input" value={kickAt} onChange={(e) => setKickAt(e.target.value)} />
                </div>
              </div>
              <p className="mt-1 text-sm font-semibold text-mute">{t('mod.ladderHelp')}</p>
              <div className="mt-2">
                <Button type="button" loading={busy} disabled={!warnOk || warnSame} onClick={() => void save({ warnTtlDays: Number(ttl), muteAt: Number(muteAt), muteMinutes: Number(muteMin), kickAt: Number(kickAt) })}>{t('common.save')}</Button>
              </div>
            </div>
          )}
          {m.punish && (
            <div>
              <label htmlFor="mod-reasons" className="label">{t('mod.reasons')}</label>
              <p className="mb-2 text-sm font-semibold text-mute">{t('mod.reasonsHelp', { n: m.maxReasons, len: m.maxReasonLen })}</p>
              <textarea id="mod-reasons" className="input min-h-24" value={reasons} onChange={(e) => setReasons(e.target.value)} />
              <div className="mt-2">
                <Button type="button" loading={busy} disabled={reasonsSame} onClick={() => void save({ reasons: reasonList })}>{t('common.save')}</Button>
              </div>
            </div>
          )}
          {m.enabled && (
            <div>
              <label htmlFor="clear-cooldown" className="label">{t('mod.cooldown')}</label>
              <p className="mb-2 text-sm font-semibold text-mute">{t('mod.cooldownHelp')}</p>
              <div className="flex flex-wrap items-center gap-3">
                <input id="clear-cooldown" type="number" min={0} max={m.maxCooldown} step={1} className="input w-28" value={cool} onChange={(e) => setCool(e.target.value)} />
                <Button type="button" loading={busy} onClick={() => void save({ cooldown: Number(cool) })} disabled={!coolOk || Number(cool) === m.cooldown}>{t('common.save')}</Button>
              </div>
            </div>
          )}
          {m.enabled && (
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
          )}
          <p className="text-sm font-semibold text-mute">{t('mod.perms')}</p>
        </div>
      )}
    </Section>
  );
}
