// What the «Игроки» card shows while the server is down: since when, for how long and why, and a strip of the period's availability
// (a chart of «0 players» in red stripes says nothing); the chart itself can still be opened.
import { useState, type ReactNode } from 'react';
import { t, useI18n } from '../../i18n';
import { fmtTime, fmtDateTime, num } from '../../ui';
import { durText } from '../servers/serverUi';
import { uptimeCells, type UptimeCell } from './serverLogic';

const CELL_LABEL: Record<UptimeCell, string> = { up: 'работал', down: 'не отвечал', part: 'были сбои', none: 'нет данных' };

export default function OfflineState({ since, atLeast, error, points, hours, now, uptimePct, windowLabel, children }: {
  since: number | null;
  atLeast: boolean;
  error: string | null;
  points: { ts: number; online: number }[];
  hours: number;
  now: number;
  uptimePct: number | null;
  windowLabel: string;
  /** the chart, shown on demand */
  children: ReactNode;
}) {
  useI18n();
  const [chart, setChart] = useState(false);
  const start = now - hours * 3_600_000;
  const cells = uptimeCells(points, start, now, hours <= 24 ? 48 : 60);
  const long = since != null && now - since >= 20 * 3_600_000;
  return (
    <div className="off-state">
      <div className="off-plaque" role="status">
        <span className="off-dot" aria-hidden />
        <div className="min-w-0">
          <p className="off-title">
            {since == null ? t('srv.off.noTime') : atLeast ? t('srv.off.moreThan', { d: durText(now - since) }) : t('srv.off.since', { time: long ? fmtDateTime(since) : fmtTime(since), d: durText(now - since) })}
          </p>
          {error && <p className="off-why" title={error}>{error}</p>}
        </div>
      </div>
      <div className="off-up">
        <div className="off-up-head">
          <span>{t('srv.off.uptime', { w: windowLabel })}</span>
          <b>{uptimePct == null ? '–' : `${num(uptimePct)}%`}</b>
        </div>
        <div className="off-bars" role="img" aria-label={t('srv.off.uptime', { w: windowLabel })}>
          {cells.map((c, i) => <i key={i} className={`off-cell ${c.kind}`} title={`${fmtDateTime(c.from)}: ${CELL_LABEL[c.kind]}`} />)}
        </div>
        <div className="off-ticks" aria-hidden><span>{hours <= 24 ? fmtTime(start) : fmtDateTime(start)}</span><span>{t('spark.now')}</span></div>
      </div>
      <button type="button" className="btn btn-ghost btn-sm off-toggle" aria-expanded={chart} onClick={() => setChart((v) => !v)}>
        {chart ? t('srv.off.hideChart') : t('srv.off.showChart')}
      </button>
      {chart && children}
    </div>
  );
}
