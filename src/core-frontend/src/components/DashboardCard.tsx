import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { Button, Section, Switch, fail, toast } from '../ui';
import { ChannelName, ChannelPicker } from './ChannelPicker';

interface Dash {
  enabled: boolean;
  channelId: string;
  channelName: string | null;
  error: string;
  weekly: boolean;
  botOnline: boolean;
}

/** the live dashboard message in a channel and the weekly summary for the administrators */
export default function DashboardCard() {
  const [d, setD] = useState<Dash | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let alive = true;
    api<Dash>('/settings/dashboard').then((r) => { if (alive) setD(r); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!d) return null;

  const save = async (patch: Partial<Pick<Dash, 'enabled' | 'channelId' | 'weekly'>>) => {
    setBusy(true);
    try {
      setD(await api<Dash>('/settings/dashboard', 'PUT', patch));
      toast(t('dash.saved'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await api<{ sent: number }>('/settings/dashboard/weekly-test', 'POST');
      toast(r.sent ? t('dash.testSent', { n: r.sent }) : t('dash.testNone'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('dash.title')}>
      <p className="mb-3 text-sm font-semibold text-mute">{t('dash.help')}</p>
      <label className="mb-3 flex items-center gap-3 font-bold">
        <Switch id="dash-on" checked={d.enabled} onChange={(on) => void save({ enabled: on })} /> {t('dash.on')}
      </label>
      <div className="mb-4">
        <span className="label">{t('dash.channel')}</span>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-black">{d.channelId ? <ChannelName id={d.channelId} /> : t('dash.noChannel')}</span>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => setPicking(!picking)} aria-expanded={picking}>{t('mod.pick')}</button>
        </div>
        {picking && <div className="mt-2"><ChannelPicker id="dash-channel" value={d.channelId} onChange={(v) => { if (/^\d{15,25}$/.test(v)) { void save({ channelId: v, enabled: true }); setPicking(false); } }} /></div>}
        {d.enabled && d.error && <p className="mt-2 text-sm font-bold text-red-500" role="alert">{d.error}</p>}
      </div>
      <label className="mb-2 flex items-center gap-3 font-bold">
        <Switch id="weekly-on" checked={d.weekly} onChange={(on) => void save({ weekly: on })} /> {t('dash.weekly')}
      </label>
      <p className="mb-3 text-sm font-semibold text-mute">{t('dash.weeklyHelp')}</p>
      <Button type="button" loading={busy} onClick={() => void test()}>{t('dash.test')}</Button>
    </Section>
  );
}
