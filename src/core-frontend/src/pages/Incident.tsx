import { useCallback, useState } from 'react';
import { api, type StatusIncident } from '../api';
import { t, useI18n } from '../i18n';
import { CopyButton, GameAvatar, LoadError, PageHead, fmtDateTime, fmtTime, usePoll } from '../ui';
import { IconError, IconInfo, IconOk } from '../icons';
import '../styles/status.css';

export type IncidentEvent =
  | { ts: number; kind: 'down'; playersBefore: number; planned: boolean }
  | { ts: number; kind: 'up'; minutes: number }
  | { ts: number; kind: 'note'; title: string; body: string; level: string }
  | { ts: number; kind: 'noteDone'; title: string }
  | { ts: number; kind: 'change'; what: string; from: string; to: string };

export interface IncidentData { incident: StatusIncident; timeline: IncidentEvent[]; points: { ts: number; online: boolean; players: number }[] }

/** «1 ч 12 мин» / «12 мин» */
export function lasted(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? t('inc.dur.hm', { h, m }) : t('inc.dur.m', { m: Math.max(1, m) });
}

/** the players around the outage: a column per poll, the polls without an answer are red and full height */
function PlayersStrip({ points }: { points: IncidentData['points'] }) {
  if (points.length < 2) return null;
  const max = Math.max(1, ...points.map((p) => p.players));
  const w = 100 / points.length;
  return (
    <figure className="panel p-4">
      <figcaption className="mb-2 font-black">{t('inc.chart')}</figcaption>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-32 w-full" role="img" aria-label={t('inc.chartAlt', { n: max })}>
        {points.map((p, i) => (p.online
          ? <rect key={p.ts} x={i * w} y={32 - Math.max(0.6, (p.players / max) * 32)} width={w * 0.8} height={Math.max(0.6, (p.players / max) * 32)} fill="rgb(var(--ok))" opacity="0.75" />
          : <rect key={p.ts} x={i * w} y="0" width={w} height="32" fill="rgb(var(--bad))" opacity="0.35" />))}
      </svg>
      <div className="mt-1 flex justify-between text-xs font-bold text-mute"><span>{fmtTime(points[0].ts)}</span><span>{t('inc.chartPeak', { n: max })}</span><span>{fmtTime(points[points.length - 1].ts)}</span></div>
    </figure>
  );
}

function EventLine({ e }: { e: IncidentEvent }) {
  const [tone, Ico] = e.kind === 'down' ? ['bg-badbg text-bad', IconError] as const : e.kind === 'up' || e.kind === 'noteDone' ? ['bg-okbg text-ok', IconOk] as const : ['bg-soft text-link', IconInfo] as const;
  const title = e.kind === 'down' ? (e.planned ? t('inc.e.planned') : t('inc.e.down'))
    : e.kind === 'up' ? t('inc.e.up', { dur: lasted(e.minutes) })
    : e.kind === 'note' ? e.title
    : e.kind === 'noteDone' ? t('inc.e.noteDone', { title: e.title })
    : e.what === 'map' ? t('inc.e.map', { to: e.to }) : t('inc.e.version', { to: e.to });
  const text = e.kind === 'down' && e.playersBefore > 0 ? t('inc.e.players', { n: e.playersBefore })
    : e.kind === 'note' ? e.body
    : e.kind === 'change' && e.from ? t('inc.e.was', { from: e.from }) : '';
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${tone}`}><Ico size={18} /></span>
      <div className="min-w-0 flex-1">
        <p className="font-extrabold wrap-break-word">{title}</p>
        {text && <p className="text-sm font-semibold text-mute wrap-break-word">{text}</p>}
        <time className="text-xs font-bold text-mute" dateTime={new Date(e.ts).toISOString()}>{fmtDateTime(e.ts)}</time>
      </div>
    </li>
  );
}

/** /status/incident/<server>/<start>: one outage with its own address, for a link in a chat */
export default function IncidentPage({ serverId, start }: { serverId: number; start: number }) {
  useI18n();
  const [data, setData] = useState<IncidentData | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api<IncidentData>(`/status/incidents/${serverId}/${start}`).then((d) => { setData(d); setError(''); }).catch((e: Error) => setError(e.message)), [serverId, start]);
  // while the outage goes on, the page follows it
  usePoll(load, data && data.incident.end == null ? 30_000 : 300_000);

  const back = <a className="btn btn-soft btn-sm" href="/status">{t('inc.back')}</a>;
  if (error && !data) return <div className="space-y-4">{back}<LoadError error={error} onRetry={() => void load()} /></div>;
  if (!data) return <div className="skeleton panel h-64" aria-busy="true" aria-label={t('st.loading')} />;
  const i = data.incident;
  const live = i.end == null;
  return (
    <div className="space-y-5">
      <PageHead icon={<GameAvatar game={i.game} size={40} />} title={i.planned ? t('inc.titlePlanned', { name: i.serverName }) : t('inc.title', { name: i.serverName })} subtitle={live ? t('inc.live', { dur: lasted(i.minutes) }) : t('inc.past', { dur: lasted(i.minutes) })}>
        {back}
        <CopyButton text={`${window.location.origin}/status/incident/${i.serverId}/${i.start}`} label={t('inc.copy')} />
      </PageHead>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="panel p-4"><dt className="t-caption">{t('inc.from')}</dt><dd className="t-num text-lg">{fmtDateTime(i.start)}</dd></div>
        <div className="panel p-4"><dt className="t-caption">{t('inc.to')}</dt><dd className={`t-num text-lg ${live ? 'text-bad' : ''}`}>{live ? t('inc.still') : fmtDateTime(i.end as number)}</dd></div>
        <div className="panel p-4"><dt className="t-caption">{t('inc.before')}</dt><dd className="t-num text-lg">{i.playersBefore}</dd></div>
      </dl>
      <PlayersStrip points={data.points} />
      <section className="panel p-5" aria-labelledby="inc-story">
        <h2 id="inc-story" className="t-section mb-3">{t('inc.story')}</h2>
        <ol className="space-y-4">{data.timeline.map((e) => <EventLine key={`${e.kind}-${e.ts}`} e={e} />)}</ol>
      </section>
      <p><a className="text-link hover:underline" href={`/servers/${i.serverId}`}>{t('inc.server', { name: i.serverName })}</a></p>
    </div>
  );
}
