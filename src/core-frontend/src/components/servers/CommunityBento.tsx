/**
 * The top of the main page: the community at a glance. Players online now against the 30-day record (a new record
 * gets a small celebration), when the community usually plays, and the latest arrivals.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { AnimatedNumber, Burst, GameAvatar, ago, fmtDateTime, plural, usePoll, num } from '../../ui';
import '../../styles/community.css';

export interface Community {
  now: { players: number; online: number; servers: number };
  record: { players: number; at: number } | null;
  heatmap: { cells: (number | null)[][]; busiest: { dow: number; hour: number; avg: number } | null };
  players: { day: number; week: number; month: number; newWeek: number };
  feed: { name: string; serverId: number; serverName: string; game: string; at: number; online: boolean; newcomer: boolean }[];
  top: { week: { name: string; hours: number; servers: number }[]; month: { name: string; hours: number; servers: number }[] };
  servers: { id: number; name: string; game: string; online: boolean; players: number; maxPlayers: number }[];
}

export const DOW_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DOW_IN = ['по понедельникам', 'по вторникам', 'по средам', 'по четвергам', 'по пятницам', 'по субботам', 'по воскресеньям'];
const RECORD_KEY = 'coregsm_record_seen';

export function useCommunity(): Community | null {
  const [data, setData] = useState<Community | null>(null);
  usePoll(() => api<Community>('/community').then(setData).catch(() => undefined), 30_000);
  return data;
}

/** weekday x hour of the whole community, small */
export function MiniHeat({ cells, big = false }: { cells: (number | null)[][]; big?: boolean }) {
  const max = Math.max(1, ...cells.flat().map((v) => v ?? 0));
  return (
    <div className={`cm-heat ${big ? 'is-big' : ''}`} role="img" aria-label="Когда играет сообщество: по дням недели и часам">
      {cells.map((row, d) => (
        <div key={d} className="contents">
          <span className="cm-heat-d">{DOW_SHORT[d]}</span>
          {row.map((v, h) => (
            <span key={h} className="cm-heat-c" style={v == null ? undefined : { ['--a' as string]: (0.12 + 0.88 * (v / max)).toFixed(3) }} title={v == null ? undefined : `${DOW_SHORT[d]} ${String(h).padStart(2, '0')}:00 — в среднем ${num(v)}`} />
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
      меньше {[0.15, 0.4, 0.7, 1].map((a) => <i key={a} style={{ ['--a' as string]: a }} />)} больше
    </p>
  );
}

export function busiestText(b: Community['heatmap']['busiest']) {
  return b ? `Больше всего игроков ${DOW_IN[b.dow]} около ${String(b.hour).padStart(2, '0')}:00` : 'Данных пока мало';
}

export function FeedItem({ f }: { f: Community['feed'][number] }) {
  return (
    <li className="cm-feed-i">
      <GameAvatar game={f.game} size={30} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          <a href={`/player/${encodeURIComponent(f.name)}`} className="font-extrabold hover:text-link">{f.name}</a>
          <span className="text-mute"> зашёл на </span>
          <a href={`/servers/${f.serverId}`} className="font-bold hover:text-link">{f.serverName}</a>
        </span>
        <span className="flex items-center gap-2 text-xs font-bold text-mute">
          {ago(f.at)}
          {f.online && <span className="cm-live">в игре</span>}
          {f.newcomer && <span className="cm-new">новичок</span>}
        </span>
      </span>
    </li>
  );
}

export default function CommunityBento() {
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
      <section className={`tile cm-now ${isRecord ? 'is-record' : ''}`} aria-label="Сейчас играют">
        <div className="cm-k">Сейчас играют</div>
        <div className="relative inline-flex items-baseline gap-2">
          <AnimatedNumber value={c.now.players} className="cm-big" pulse />
          <span className="font-extrabold text-mute">{plural(c.now.players, ['игрок', 'игрока', 'игроков'])}</span>
          {celebrate && <Burst count={14} radius={46} />}
        </div>
        <div className="cm-meter" aria-hidden><span style={{ width: `${toRecord * 100}%` }} /></div>
        <p className="cm-sub">
          {isRecord ? '🎉 Это рекорд за 30 дней!' : rec ? `Рекорд за 30 дней: ${rec.players} (${fmtDateTime(rec.at)})` : 'Рекорд появится, когда накопится история'}
        </p>
        <a href="/community" className="cm-more">Сообщество: кто и когда играет →</a>
        <dl className="cm-mini">
          <div><dt>Серверов в сети</dt><dd>{c.now.online} из {c.now.servers}</dd></div>
          <div><dt>Игроков за неделю</dt><dd>{c.players.week}</dd></div>
          <div><dt>Новых за неделю</dt><dd>{c.players.newWeek}</dd></div>
        </dl>
      </section>

      <section className="tile cm-when" aria-label="Когда играет сообщество">
        <div className="cm-k">Когда играет сообщество</div>
        <MiniHeat cells={c.heatmap.cells} />
        <p className="cm-sub">{busiestText(c.heatmap.busiest)}</p>
      </section>

      <section className="tile cm-feed" aria-label="Живая лента">
        <div className="flex items-center justify-between gap-2">
          <div className="cm-k">Живая лента</div>
          <a href="/community" className="text-xs font-extrabold text-link hover:underline">Сообщество →</a>
        </div>
        {c.feed.length ? <ul className="cm-feed-list">{c.feed.slice(0, 5).map((f) => <FeedItem key={`${f.name}-${f.at}`} f={f} />)}</ul> : <p className="cm-sub">Пока никто не заходил.</p>}
      </section>
    </div>
  );
}
