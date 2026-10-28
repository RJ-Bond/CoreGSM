/**
 * The top of the main page: the community at a glance. Players online now against the 30-day record (a new record
 * gets a small celebration), when the community usually plays, and the latest arrivals.
 */
import NickPic from '../NickPic';
import { t, useI18n, type TKey } from '../../i18n';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { AnimatedNumber, Burst, GameAvatar, ago, fmtDateTime, usePoll, num } from '../../ui';
import '../../styles/community.css';

export interface TopPlayer { name: string; hours: number; servers: number; serverId?: number; online: boolean; prev: number | null }

export interface Community {
  now: { players: number; online: number; servers: number };
  record: { players: number; at: number } | null;
  heatmap: { cells: (number | null)[][]; busiest: { dow: number; hour: number; avg: number } | null };
  players: { day: number; week: number; month: number; newWeek: number; prev: { day: number; week: number; month: number; newWeek: number } };
  /** players on all servers over the last 24 h, 30-minute steps */
  series: { ts: number; players: number }[];
  feed: { name: string; serverId: number; serverName: string; game: string; at: number; online: boolean; newcomer: boolean }[];
  top: Record<'day' | 'week' | 'month' | 'all', TopPlayer[]>;
  servers: { id: number; name: string; game: string; online: boolean; players: number; maxPlayers: number }[];
}

/** weekday names in the panel's language, Monday first */
export const dowShort = (): string[] => Array.from({ length: 7 }, (_, i) => t(`cm.dow.${i}` as TKey));
const RECORD_KEY = 'coregsm_record_seen';

/** the community data with the time of the last answer and a way to ask again at once */
export function useCommunityLive(): { data: Community | null; at: number; busy: boolean; refresh: () => void } {
  const [data, setData] = useState<Community | null>(null);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const load = () => api<Community>('/community').then((d) => { setData(d); setAt(Date.now()); }).catch(() => undefined);
  usePoll(load, 30_000);
  const refresh = () => { setBusy(true); void load().finally(() => setTimeout(() => setBusy(false), 400)); };
  return { data, at, busy, refresh };
}

export function useCommunity(): Community | null {
  return useCommunityLive().data;
}

/** a round «avatar» of a player: the first letter on a colour taken from the nick (the panel has no pictures of game nicks) */
export function PlayerAvatar({ name, size = 30, online = false }: { name: string; size?: number; online?: boolean }) {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="cm-ava" style={{ width: size, height: size, fontSize: size * 0.46, ['--h' as string]: h }} aria-hidden>
      <NickPic name={name} size={size} className="cm-ava-img">{name.slice(0, 1).toUpperCase()}</NickPic>
      {online && <i className="cm-ava-on" />}
    </span>
  );
}

/** weekday x hour of the whole community, small */
export function MiniHeat({ cells, big = false, now }: { cells: (number | null)[][]; big?: boolean; now?: { dow: number; hour: number } }) {
  const max = Math.max(1, ...cells.flat().map((v) => v ?? 0));
  return (
    <div className={`cm-heat ${big ? 'is-big' : ''}`} role="img" aria-label={t('cm.heat.aria')}>
      {cells.map((row, d) => (
        <div key={d} className="contents">
          <span className="cm-heat-d">{dowShort()[d]}</span>
          {row.map((v, h) => (
            <span key={h} className={`cm-heat-c ${now && now.dow === d && now.hour === h ? 'is-now' : ''}`} style={v == null ? undefined : { ['--a' as string]: (0.12 + 0.88 * (v / max)).toFixed(3) }} title={v == null ? undefined : t('cm.heat.cell', { d: dowShort()[d], time: `${String(h).padStart(2, '0')}:00`, n: num(v) })} />
          ))}
        </div>
      ))}
      <span />
      {Array.from({ length: 24 }, (_, h) => <span key={h} className="cm-heat-h">{h % 6 === 0 ? h : ''}</span>)}
    </div>
  );
}

/** the colour scale of the heat map: lighter = fewer players */
export function HeatLegend() {
  return (
    <p className="cm-heat-scale" aria-hidden>
      {t('cm.heat.less')} {[0.15, 0.4, 0.7, 1].map((a) => <i key={a} style={{ ['--a' as string]: a }} />)} {t('cm.heat.more')}
    </p>
  );
}

export function busiestText(b: Community['heatmap']['busiest']) {
  return b ? t('cm.busiest', { when: t(`cm.dowIn.${b.dow}` as TKey), time: `${String(b.hour).padStart(2, '0')}:00` }) : t('cm.busiest.none');
}

export function FeedItem({ f }: { f: Community['feed'][number] }) {
  return (
    <li className="cm-feed-i">
      <span className="relative shrink-0">
        <PlayerAvatar name={f.name} size={32} online={f.online} />
        <span className="cm-ava-game"><GameAvatar game={f.game} size={16} /></span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          <a href={`/player/${encodeURIComponent(f.name)}`} className="font-extrabold hover:text-link">{f.name}</a>
          <span className="text-mute">{t('cm.joined')}</span>
          <a href={`/servers/${f.serverId}`} className="font-bold hover:text-link">{f.serverName}</a>
        </span>
        <span className="flex items-center gap-2 text-xs font-bold text-mute">
          {ago(f.at)}
          {f.online && <span className="cm-live">{t('cm.live')}</span>}
          {f.newcomer && <span className="cm-new">{t('cm.new')}</span>}
        </span>
      </span>
    </li>
  );
}

export default function CommunityBento() {
  useI18n();
  const c = useCommunity();
  const [celebrate, setCelebrate] = useState(false);
  const shown = useRef(false);

  // a new record (higher than any the visitor has already celebrated): confetti once
  useEffect(() => {
    if (!c?.record || shown.current) return;
    const isRecord = c.now.players > 0 && c.now.players >= c.record.players;
    if (!isRecord) return;
    let seen = 0;
    try { seen = Number(localStorage.getItem(RECORD_KEY)) || 0; } catch { /* no storage */ }
    if (c.now.players > seen) {
      shown.current = true;
      setCelebrate(true);
      try { localStorage.setItem(RECORD_KEY, String(c.now.players)); } catch { /* not remembered */ }
      window.setTimeout(() => setCelebrate(false), 4000);
    }
  }, [c]);

  if (!c) return <div className="cm-bento" aria-busy="true"><div className="tile skeleton h-44" /><div className="tile skeleton h-44" /><div className="tile skeleton h-44" /></div>;
  const rec = c.record;
  const toRecord = rec ? Math.max(0, Math.min(1, c.now.players / Math.max(1, rec.players))) : 0;
  const isRecord = !!rec && c.now.players > 0 && c.now.players >= rec.players;
  return (
    <div className="cm-bento fade-in">
      <section className={`tile cm-now ${isRecord ? 'is-record' : ''}`} aria-label={t('cm.b.now')}>
        <div className="cm-k">{t('cm.b.now')}</div>
        <div className="relative inline-flex items-baseline gap-2">
          <AnimatedNumber value={c.now.players} className="cm-big" pulse />
          <span className="font-extrabold text-mute">{t('cm.word.players', { n: c.now.players })}</span>
          {celebrate && <Burst count={14} radius={46} />}
        </div>
        <div className="cm-meter" aria-hidden><span style={{ width: `${toRecord * 100}%` }} /></div>
        <p className="cm-sub">
          {isRecord ? t('cm.rec.now') : rec ? t('cm.b.rec', { n: rec.players, when: fmtDateTime(rec.at) }) : t('cm.b.recNone')}
        </p>
        <a href="/community" className="cm-more">{t('cm.b.more')}</a>
        <dl className="cm-mini">
          <div><dt>{t('cm.b.online')}</dt><dd>{t('cm.b.of', { a: c.now.online, b: c.now.servers })}</dd></div>
          <div><dt>{t('cm.b.week')}</dt><dd>{c.players.week}</dd></div>
          <div><dt>{t('cm.st.new')}</dt><dd>{c.players.newWeek}</dd></div>
        </dl>
      </section>

      <section className="tile cm-when" aria-label={t('cm.when')}>
        <div className="cm-k">{t('cm.when')}</div>
        <MiniHeat cells={c.heatmap.cells} />
        <p className="cm-sub">{busiestText(c.heatmap.busiest)}</p>
      </section>

      <section className="tile cm-feed" aria-label={t('cm.feed')}>
        <div className="flex items-center justify-between gap-2">
          <div className="cm-k">{t('cm.feed')}</div>
          <a href="/community" className="text-xs font-extrabold text-link hover:underline">{t('cm.b.comm')}</a>
        </div>
        {c.feed.length ? <ul className="cm-feed-list">{c.feed.slice(0, 5).map((f) => <FeedItem key={`${f.name}-${f.at}`} f={f} />)}</ul> : <p className="cm-sub">{t('cm.b.noFeed')}</p>}
      </section>
    </div>
  );
}
