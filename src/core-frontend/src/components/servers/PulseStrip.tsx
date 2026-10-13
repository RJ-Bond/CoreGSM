// The «pulse» strip above the servers: one sentence about the state, four numbers and a 24-hour chart of players.
import { useId } from 'react';
import { AnimatedNumber, fmtTime, LAG_PING } from '../../ui';
import { IconError, IconOk, IconWarn, IconWrench, IconClock } from '../../icons';
import { t, useI18n } from '../../i18n';
import type { Server } from '../../api';
import { chartPoints, pulseOf, type OverviewData, type PulseState } from './overviewLogic';

const ICON: Record<PulseState, JSX.Element> = {
  ok: <IconOk size={24} />,
  warn: <IconWarn size={24} />,
  bad: <IconError size={24} />,
  maint: <IconWrench size={24} />,
  wait: <IconClock size={24} />,
};

function PlayersChart({ data, now }: { data: OverviewData | null; now: number }) {
  const gid = useId().replace(/:/g, '');
  const { t: tr } = useI18n();
  if (!data || data.points.length < 2) {
    return <div className="pulse-chart pulse-chart-empty">{tr('srv.pulse.noChart')}</div>;
  }
  const end = Math.max(now, data.points[data.points.length - 1].ts + data.bucketMs);
  const start = end - data.hours * 3_600_000;
  const pts = chartPoints(data.points, start, end);
  const W = 240;
  const H = 56;
  const pad = 4;
  const X = (x: number) => x * W;
  const Y = (y: number) => H - pad - y * (H - pad * 2);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join('');
  const area = `${line}L${X(pts[pts.length - 1].x).toFixed(1)} ${H}L${X(pts[0].x).toFixed(1)} ${H}Z`;
  const max = Math.max(1, ...data.points.map((p) => p.players));
  const peak = data.peak;
  const pk = peak ? { x: Math.max(0, Math.min(1, (peak.ts - start) / (end - start))), y: peak.players / max } : null;
  return (
    <figure className="pulse-chart" aria-label={tr('srv.pulse.chart')}>
      <div className="pulse-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-hidden>
          <defs>
            <linearGradient id={`pg${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity=".32" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#pg${gid})`} />
          <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {pk && peak && (
          <span className="pulse-peak" style={{ left: `${pk.x * 100}%`, top: `${((Y(pk.y)) / H) * 100}%` }} aria-hidden />
        )}
      </div>
      <figcaption>
        <span>{tr('srv.pulse.hours', { n: data.hours })}</span>
        {peak ? <span className="pulse-peak-text">{tr('srv.pulse.peak', { n: peak.players, time: fmtTime(peak.ts) })}</span> : <span>{tr('srv.pulse.noPeak')}</span>}
      </figcaption>
    </figure>
  );
}

export function PulseStrip({ servers, overview, uptime, now }: { servers: Server[]; overview: OverviewData | null; uptime: number | null; now: number }) {
  useI18n();
  const { state, problems } = pulseOf(servers);
  const online = servers.filter((s) => s.online);
  const players = online.reduce((n, s) => n + s.players, 0);
  const pings = online.filter((s) => s.ping != null).map((s) => s.ping as number);
  const avg = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null;

  let title: string;
  let sub = '';
  if (state === 'bad' || state === 'warn') {
    const first = problems[0];
    title = t('srv.pulse.problems', { name: first.name });
    sub = problems.length > 1 ? t('srv.pulse.more', { n: problems.length - 1 }) : first.online ? t('srv.pulse.slow') : t('srv.pulse.noAnswer');
  } else if (state === 'maint') {
    const m = servers.filter((s) => s.maintenance);
    title = t('srv.pulse.maint');
    sub = m.length === 1 ? m[0].name : t('srv.pulse.maintN', { n: m.length });
  } else if (state === 'wait') {
    title = t('srv.pulse.wait');
  } else {
    title = t('srv.pulse.ok');
    sub = t('srv.pulse.okSub', { n: online.length });
  }

  return (
    <section className={`pulse pulse-${state}`} aria-label={t('srv.pulse.label')}>
      <div className="pulse-state" role="status">
        <span className="pulse-icon" aria-hidden>{ICON[state]}</span>
        <div className="min-w-0">
          <div className="pulse-title">{title}</div>
          {sub && <div className="pulse-sub">{sub}</div>}
        </div>
      </div>
      <dl className="pulse-nums">
        <div>
          <dt>{t('srv.pulse.players')}</dt>
          <dd><AnimatedNumber value={players} pulse /></dd>
        </div>
        <div>
          <dt>{t('srv.pulse.servers')}</dt>
          <dd>{online.length}<small>/{servers.length}</small></dd>
        </div>
        <div>
          <dt>{t('srv.pulse.ping')}</dt>
          <dd className={avg != null && avg > LAG_PING ? 'text-warn' : ''}>{avg == null ? '–' : <>{avg}<small> {t('srv.unit.ms')}</small></>}</dd>
        </div>
        <div>
          <dt>{t('srv.pulse.uptime')}</dt>
          <dd>{uptime == null ? '–' : <>{(Math.round(uptime * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })}<small>%</small></>}</dd>
        </div>
      </dl>
      <PlayersChart data={overview} now={now} />
    </section>
  );
}
