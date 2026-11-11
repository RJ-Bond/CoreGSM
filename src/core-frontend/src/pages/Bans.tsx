import { useMemo, useState } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';
import { Empty, ErrorLine, LoadError, PageHead, ago, fmtDateTime, usePoll } from '../ui';
import { useAuth } from '../auth';
import ArtPic from '../components/ArtPic';
import '../styles/bans.css';

export interface PublicBan {
  nick: string;
  reason: string;
  serverId: number;
  server: string;
  scope: 'all' | 'server';
  createdAt: number;
  until: number;
  admin?: string;
  platformId?: string;
}

export interface BansData {
  total: number;
  forever: number;
  last7d: number;
  servers: { id: number; name: string; count: number }[];
  items: PublicBan[];
}

const IconBan = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" /><path d="m5.7 5.7 12.6 12.6" />
  </svg>
);
export { IconBan };

/** «ещё 3 дн.» / «ещё 5 ч» / «ещё 20 мин»: what is left of a ban */
export function leftText(untilMs: number, now: number): string {
  const ms = Math.max(0, untilMs - now);
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return t('bans.left.m', { n: Math.max(1, min) });
  const h = Math.ceil(min / 60);
  if (h < 48) return t('bans.left.h', { n: h });
  return t('bans.left.d', { n: Math.ceil(h / 24) });
}

/** the filter of the list: a server (0 = all) and a piece of the nickname or of the reason */
export function filterBans(items: PublicBan[], server: number, q: string): PublicBan[] {
  const s = q.trim().toLowerCase();
  return items.filter((b) => (server === 0 || b.scope === 'all' || b.serverId === server) && (!s || b.nick.toLowerCase().includes(s) || b.reason.toLowerCase().includes(s)));
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="bn-stat">
      <b className="tabular-nums">{n}</b>
      <span>{label}</span>
    </div>
  );
}

function Row({ b, now, staff }: { b: PublicBan; now: number; staff: boolean }) {
  const forever = b.until === 0;
  return (
    <li className="bn-row">
      <span className="bn-ava" aria-hidden>{(Array.from(b.nick)[0] ?? '?').toUpperCase()}</span>
      <div className="bn-main">
        <div className="bn-head">
          <b className="bn-nick">{b.nick || '—'}</b>
          <time className="bn-when" dateTime={new Date(b.createdAt).toISOString()} title={fmtDateTime(b.createdAt)}>{ago(b.createdAt)}</time>
        </div>
        <p className={`bn-reason ${b.reason ? '' : 'is-none'}`}>{b.reason || t('bans.noReason')}</p>
        <div className="bn-meta">
          {b.server && <span className="bn-chip">{b.server}</span>}
          <span className="bn-chip">{b.scope === 'server' ? t('bans.scope.server') : t('bans.scope.all')}</span>
          {staff && b.admin && <span className="bn-chip">{t('bans.by', { name: b.admin })}</span>}
          {staff && b.platformId && <span className="bn-chip tabular-nums" title={t('bans.account')}>{b.platformId}</span>}
        </div>
      </div>
      <div className="bn-state">
        {forever ? <span className="pill pill-bad">{t('bans.forever')}</span> : <span className="pill pill-warn" title={fmtDateTime(b.until)}>{leftText(b.until, now)}</span>}
        {!forever && <span className="bn-until">{t('bans.until', { date: fmtDateTime(b.until) })}</span>}
      </div>
    </li>
  );
}

/** /bans: the bans that the game plugin has put in force */
export default function BansPage() {
  useI18n();
  const { me } = useAuth();
  const staff = me?.role === 'admin' || me?.role === 'moderator';
  const [data, setData] = useState<BansData | null>(null);
  const [error, setError] = useState('');
  const [server, setServer] = useState(0);
  const [q, setQ] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const load = () => api<BansData>('/bans').then((d) => { setData(d); setNow(Date.now()); setError(''); }).catch((e: Error) => setError(e.message));
  usePoll(load, 60_000);

  const shown = useMemo(() => (data ? filterBans(data.items, server, q) : []), [data, server, q]);

  return (
    <div className="bn-page">
      <PageHead icon={<IconBan />} title={t('nav.bans')} subtitle={t('bans.subtitle')} />
      {error && !data ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}
      {!data && !error && <div className="skeleton bn-skel" aria-busy="true" aria-label={t('bans.loading')} />}
      {data && (
        <>
          <div className="bn-stats">
            <Stat n={data.total} label={t('bans.stat.active')} />
            <Stat n={data.forever} label={t('bans.stat.forever')} />
            <Stat n={data.last7d} label={t('bans.stat.week')} />
          </div>
          {data.total > 0 && (
            <div className="bn-bar">
              <input type="search" className="input bn-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('bans.search')} aria-label={t('bans.search')} maxLength={60} />
              {data.servers.length > 1 && (
                <div className="bn-servers" role="group" aria-label={t('bans.servers')}>
                  <button type="button" className="nw-rub" aria-pressed={server === 0} onClick={() => setServer(0)}>{t('bans.allServers')}</button>
                  {data.servers.map((s) => (
                    <button key={s.id} type="button" className="nw-rub" aria-pressed={server === s.id} onClick={() => setServer(s.id)}>
                      {s.name}<span className="nw-rub-n tabular-nums">{s.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {data.total === 0 && <Empty art={<ArtPic src="empty/empty-players" size={132} />} title={t('bans.empty.title')} text={t('bans.empty.text')} />}
          {data.total > 0 && shown.length === 0 && <Empty art={<ArtPic src="empty/empty-players" size={132} />} title={t('bans.none.title')} text={t('bans.none.text')} />}
          {shown.length > 0 && (
            <ul className="bn-list fade-in" key={`${server}-${q}`} aria-label={t('nav.bans')}>
              {shown.map((b) => <Row key={`${b.platformId ?? b.nick}-${b.createdAt}`} b={b} now={now} staff={staff} />)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
