/** Admin → Оповещения: the weekly digest (settings, the numbers of the coming digest and its picture). */
import { useEffect, useState } from 'react';
import { t as tr, useI18n, type TKey } from '../i18n';
import { api } from '../api';
import { ChannelName, ChannelPicker } from './ChannelPicker';
import { ErrorLine, Section, Switch, ago, toast } from '../ui';

interface DigestInfo {
  enabled: boolean;
  channelId: string;
  weekday: number;
  hour: number;
  /** the picture: dark or light */
  theme: 'dark' | 'light';
  lastSent: number;
  preview: {
    totals: { players: number; prevPlayers: number; peak: number; peakServer: string | null; hours: number; prevHours: number; uptime: number | null; incidents: number; newPlayers: number };
  };
}

const WEEKDAYS: TKey[] = ['d2.dg.acc.0', 'd2.dg.acc.1', 'd2.dg.acc.2', 'd2.dg.acc.3', 'd2.dg.acc.4', 'd2.dg.acc.5', 'd2.dg.acc.6'];
const WEEKDAYS_NOM: TKey[] = ['d2.dg.nom.0', 'd2.dg.nom.1', 'd2.dg.nom.2', 'd2.dg.nom.3', 'd2.dg.nom.4', 'd2.dg.nom.5', 'd2.dg.nom.6'];

export default function DigestSection({ alertsChannel }: { alertsChannel: string }) {
  useI18n();
  const [info, setInfo] = useState<DigestInfo | null>(null);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [imgKey, setImgKey] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<DigestInfo>('/digest').then(setInfo).catch((e: Error) => setError(e.message));
  }, []);

  const save = async (patch: Partial<Pick<DigestInfo, 'enabled' | 'channelId' | 'weekday' | 'hour' | 'theme'>>, done?: string) => {
    await api<DigestInfo>('/digest', 'PUT', patch)
      .then((d) => { setInfo(d); setImgKey((k) => k + 1); setError(''); if (done) toast(done); })
      .catch((e: Error) => setError(e.message));
  };
  const sendNow = async () => {
    setBusy(true);
    await api<DigestInfo>('/digest/send', 'POST')
      .then((d) => { setInfo(d); toast(tr('d2.dg.t.queued')); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  if (!info) return <Section title={tr('d2.dg.title')}>{error ? <ErrorLine text={error} /> : <div className="skeleton h-24 rounded-ui-lg" aria-busy="true" />}</Section>;
  const t = info.preview.totals;
  const channel = info.channelId || alertsChannel;
  return (
    <Section title={tr('d2.dg.title')} description={tr('d2.dg.desc')}>
      <ErrorLine text={error} />
      <div className="adm-split">
      <div className="min-w-0 space-y-4">
      <label className="flex cursor-pointer items-start gap-3">
        <Switch className="mt-0.5" checked={info.enabled} onChange={(on) => void save({ enabled: on }, on ? tr('d2.dg.t.on') : tr('d2.dg.t.off'))} />
        <span>
          <span className="block font-extrabold">{tr('d2.dg.publish')}</span>
          <span className="block text-sm font-semibold text-mute">
            {channel ? tr('d2.dg.when', { day: tr(WEEKDAYS[info.weekday]), hh: String(info.hour).padStart(2, '0') }) : tr('d2.dg.needChannel')}
            {info.lastSent ? ` · ${tr('d2.dg.last', { ago: ago(info.lastSent) })}` : ''}
          </span>
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="digest-day" className="label">{tr('d2.dg.day')}</label>
          <select id="digest-day" className="input" value={info.weekday} onChange={(e) => void save({ weekday: Number(e.target.value) }, tr('d2.dg.saved'))}>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{tr(WEEKDAYS_NOM[i])}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="digest-hour" className="label">{tr('d2.rp.time')}</label>
          <select id="digest-hour" className="input" value={info.hour} onChange={(e) => void save({ hour: Number(e.target.value) }, tr('d2.dg.saved'))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="digest-theme" className="label">{tr('digest.theme')}</label>
          <select id="digest-theme" className="input" value={info.theme} onChange={(e) => void save({ theme: e.target.value as 'dark' | 'light' }, tr('d2.dg.saved'))}>
            <option value="dark">{tr('digest.theme.dark')}</option>
            <option value="light">{tr('digest.theme.light')}</option>
          </select>
        </div>
      </div>

      <div>
        <span className="label">{tr('d2.dg.channel')}</span>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-black">{info.channelId ? <ChannelName id={info.channelId} /> : alertsChannel ? tr('d2.dg.sameAsAlerts') : tr('d2.news.notChosen')}</span>
          <button className="btn btn-soft btn-sm" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>{tr('d2.dg.pickOther')}</button>
          {info.channelId && <button className="btn-link text-sm" onClick={() => void save({ channelId: '' }, tr('d2.dg.t.toAlerts'))}>{tr('upd.o.chan.reset')}</button>}
        </div>
        {picking && (
          <div className="mt-3">
            <ChannelPicker id="digest-channel" value={info.channelId} onChange={(v) => { if (/^\d{15,25}$/.test(v)) { void save({ channelId: v }, tr('d2.dg.t.channel')); setPicking(false); } }} />
          </div>
        )}
      </div>

      </div>
      <div className="adm-split-side rounded-ui-lg bg-soft p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-extrabold text-mute">{tr('d2.dg.preview')}</span>
          <span className="flex flex-wrap gap-2">
            <button className="btn btn-soft btn-sm" onClick={() => setImgKey((k) => k + 1)}>{tr('d2.dg.refresh')}</button>
            <button className="btn btn-sm" disabled={busy || !channel} onClick={() => void sendNow()}>{tr('d2.dg.sendNow')}</button>
          </span>
        </div>
        <img key={imgKey} src={`/api/digest/preview.png?k=${imgKey}`} alt={tr('d2.dg.alt', { n: t.players, peak: t.peak, hours: t.hours })} className="w-full rounded-ui-lg" loading="lazy" />
      </div>
      </div>
    </Section>
  );
}
