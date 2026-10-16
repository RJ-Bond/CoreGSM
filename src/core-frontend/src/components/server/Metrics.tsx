import type { ReactNode } from 'react';
import { t, useI18n } from '../../i18n';
import { AnimatedNumber, fmtDateTime, num } from '../../ui';
import { capLevel } from '../servers/capacity';
import { metricFill } from './serverLogic';

export interface MetricsData {
  online: boolean;
  hasStatus: boolean;
  players: number;
  maxPlayers: number;
  peak: number | null;
  peakAt: number | null;
  uptimePct: number | null;
  avg: number | null;
  samples: number;
  /** «за 24 часа» */
  windowLabel: string;
}

function Cell({ k, v, hint, fill, level }: { k: string; v: ReactNode; hint?: ReactNode; fill: number; level?: 'ok' | 'warm' | 'hot' }) {
  return (
    <div className="srv-metric">
      <div className="stat-k">{k}</div>
      <div className="srv-metric-v">{v}</div>
      <div className="srv-metric-bar" aria-hidden><i className={level ? `is-${level}` : undefined} style={{ width: `${fill}%` }} /></div>
      {hint != null && <div className="srv-metric-h">{hint}</div>}
    </div>
  );
}

/** one compact row: Сейчас · Пик · Аптайм · В среднем (small value, a hint and a static mini bar) */
export default function Metrics({ d, withSamples = false }: { d: MetricsData; withSamples?: boolean }) {
  useI18n();
  const nowPct = metricFill(d.players, d.maxPlayers);
  return (
    <div className={`srv-metrics ${withSamples ? 'has-5' : ''}`}>
      <Cell
        k="Сейчас"
        v={d.online ? <><AnimatedNumber value={d.players} delta />{d.maxPlayers > 0 && <span className="srv-metric-of">/{d.maxPlayers}</span>}</> : '–'}
        hint={d.online ? (d.maxPlayers > 0 ? t('srv.cap.taken', { pct: nowPct }) : '') : d.hasStatus ? 'недоступен' : 'ждём ответ'}
        fill={d.online ? nowPct : 0}
        level={capLevel(nowPct)}
      />
      <Cell
        k="Пик"
        v={d.peak == null ? '–' : String(d.peak)}
        hint={d.peakAt ? fmtDateTime(d.peakAt) : undefined}
        fill={metricFill(d.peak, d.maxPlayers)}
      />
      <Cell
        k="Аптайм"
        v={d.uptimePct == null ? '–' : `${num(d.uptimePct)}%`}
        hint={d.windowLabel}
        fill={d.uptimePct ?? 0}
      />
      <Cell
        k="В среднем"
        v={d.avg == null ? '–' : num(d.avg)}
        hint="пока онлайн"
        fill={metricFill(d.avg, d.maxPlayers)}
      />
      {withSamples && <Cell k="Измерений" v={String(d.samples)} hint={d.windowLabel} fill={0} />}
    </div>
  );
}
