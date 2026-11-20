import { useEffect, useState } from 'react';
import { api } from '../api';
import { IconBell } from '../components/GameNewsIcons';
import { t, useI18n } from '../i18n';
import { Switch, errText, toast } from '../ui';

interface AlertState { silentMin: number; outdated: boolean; choices: number[] }

/** what the administrators are told about the plugins themselves: a silent one, an old one (to the service channel) */
export function PluginAlertsCard() {
  useI18n();
  const [s, setS] = useState<AlertState | null>(null);
  useEffect(() => { void api<AlertState>('/game-news/plugin-alerts').then(setS).catch(() => undefined); }, []);
  const save = async (patch: Partial<Pick<AlertState, 'silentMin' | 'outdated'>>) => {
    try { setS(await api<AlertState>('/game-news/plugin-alerts', 'PUT', patch)); toast(t('al.saved')); } catch (e) { toast(errText(e), 'err'); }
  };
  if (!s) return <div className="skeleton h-24 rounded-2xl" aria-busy="true" />;
  return (
    <section className="panel space-y-3 p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-soft text-link"><IconBell size={20} /></span>
        <div className="min-w-0">
          <h3 className="font-extrabold">{t('gn.pa.title')}</h3>
          <p className="text-sm font-semibold text-mute">{t('gn.pa.note')}</p>
        </div>
      </div>
      <label className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 flex-1 basis-60 font-bold">{t('gn.pa.silent')}<span className="block text-sm font-semibold text-mute">{t('gn.pa.silentHint')}</span></span>
        <select className="input w-40" value={s.silentMin} aria-label={t('gn.pa.silent')} onChange={(e) => void save({ silentMin: Number(e.target.value) })}>
          {s.choices.map((m) => <option key={m} value={m}>{m === 0 ? t('gn.pa.off') : t('gn.pa.min', { n: m })}</option>)}
        </select>
      </label>
      <label className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 flex-1 basis-60 font-bold">{t('gn.pa.outdated')}<span className="block text-sm font-semibold text-mute">{t('gn.pa.outdatedHint')}</span></span>
        <Switch checked={s.outdated} onChange={(v) => void save({ outdated: v })} aria-label={t('gn.pa.outdated')} />
      </label>
    </section>
  );
}
