import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { t, type TKey, useI18n } from '../i18n';
import { ErrorLine, Section, Switch, errText } from '../ui';

type Rating = 'good' | 'needs' | 'poor';
interface Row { route: string; metric: 'LCP' | 'INP' | 'CLS' | 'TTFB' | 'FCP'; n: number; p75: number; good: number; rating: Rating }
interface Summary { enabled: boolean; days: number; rows: Row[] }

const METRICS: Row['metric'][] = ['LCP', 'INP', 'CLS', 'TTFB'];
const show = (metric: Row['metric'], v: number): string => (metric === 'CLS' ? v.toFixed(2) : v >= 1000 ? `${(v / 1000).toFixed(1)} ${t('rum.s')}` : `${Math.round(v)} ${t('rum.ms')}`);

/** «Скорость у посетителей»: the 75th percentile of what real visitors saw, per page and metric, coloured by web.dev limits */
export default function RumCard() {
  useI18n();
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api<Summary>('/rum/summary?days=7').then((r) => { setS(r); setError(''); }).catch((e) => setError(errText(e))), []);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (enabled: boolean) => {
    try {
      await api('/rum/settings', 'PUT', { enabled });
      await load();
    } catch (e) {
      setError(errText(e));
    }
  };
  const routes = s ? [...new Set(s.rows.map((r) => r.route))].sort() : [];
  const cell = (route: string, metric: Row['metric']) => s?.rows.find((r) => r.route === route && r.metric === metric);
  return (
    <Section title={t('rum.title')} description={t('rum.desc')} actions={s && <label className="flex items-center gap-2 text-sm font-bold"><Switch checked={s.enabled} onChange={(on) => void toggle(on)} />{t('rum.collect')}</label>}>
      <ErrorLine text={error} />
      {s && s.rows.length === 0 && <p className="font-semibold text-mute">{s.enabled ? t('rum.none') : t('rum.off')}</p>}
      {s && s.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="rum-table w-full text-left">
            <thead>
              <tr><th scope="col">{t('rum.page')}</th>{METRICS.map((m) => <th key={m} scope="col">{m}</th>)}<th scope="col">{t('rum.visits')}</th></tr>
            </thead>
            <tbody>
              {routes.map((r) => {
                const visits = Math.max(...METRICS.map((m) => cell(r, m)?.n ?? 0));
                return (
                  <tr key={r}>
                    <th scope="row">{t(`rum.r.${r}` as TKey)}</th>
                    {METRICS.map((m) => {
                      const c = cell(r, m);
                      return <td key={m}>{c ? <span className={`rum-v is-${c.rating}`} title={t('rum.good', { n: c.good })}>{show(m, c.p75)}</span> : '–'}</td>;
                    })}
                    <td className="tabular-nums text-mute">{visits}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm font-semibold text-mute">{t('rum.note', { d: s?.days ?? 7 })}</p>
    </Section>
  );
}
