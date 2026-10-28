import { useEffect, useState } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';
import { Section, Switch, toast, fail } from '../ui';

const OPTIONS = [0, 3, 5, 8, 10, 15, 20];

/** «Ники в сообщении»: how many player names the Discord message lists; the rest is a link to the site. */
export default function PlayersShownCard() {
  useI18n();
  const [value, setValue] = useState<number | null>(null);
  const [chart, setChart] = useState(true);
  const [tile, setTile] = useState(false);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ playersShown: number; chart: boolean; iconTile: boolean }>('/settings/embed')
      .then((r) => { if (alive) { setValue(r.playersShown); setChart(r.chart); setTile(r.iconTile); } })
      .catch(() => { if (alive) setGone(true); });
    return () => { alive = false; };
  }, []);

  if (gone || value === null) return null;

  const change = async (n: number) => {
    const prev = value;
    setValue(n);
    setBusy(true);
    try {
      await api('/settings/embed', 'PUT', { playersShown: n });
      toast(t('d2.psc.t.saved'));
    } catch (e) {
      setValue(prev);
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const flag = async (patch: { chart?: boolean; iconTile?: boolean }) => {
    setBusy(true);
    try {
      const r = await api<{ chart: boolean; iconTile: boolean }>('/settings/embed', 'PUT', patch);
      setChart(r.chart);
      setTile(r.iconTile);
      toast(t('d2.psc.t.saved'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const options = OPTIONS.includes(value) ? OPTIONS : [...OPTIONS, value].sort((a, b) => a - b);

  return (
    <Section title={t('d2.psc.title')} description={t('d2.psc.desc')}>
      <label htmlFor="players-shown" className="label">{t('d2.psc.show')}</label>
      <select id="players-shown" className="input max-w-[16rem]" value={value} disabled={busy} onChange={(e) => void change(Number(e.target.value))}>
        {options.map((n) => <option key={n} value={n}>{n === 0 ? t('d2.psc.counterOnly') : String(n)}</option>)}
      </select>
      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <Switch className="mt-0.5" checked={chart} disabled={busy} onChange={(on) => void flag({ chart: on })} />
        <span>
          <span className="block font-extrabold">{t('embed.chart')}</span>
          <span className="block text-sm font-semibold text-mute">{t('embed.chart.hint')}</span>
        </span>
      </label>
      <label className="mt-3 flex cursor-pointer items-start gap-3">
        <Switch className="mt-0.5" checked={tile} disabled={busy} onChange={(on) => void flag({ iconTile: on })} />
        <span>
          <span className="block font-extrabold">{t('embed.tile')}</span>
          <span className="block text-sm font-semibold text-mute">{t('embed.tile.hint')}</span>
        </span>
      </label>
    </Section>
  );
}
