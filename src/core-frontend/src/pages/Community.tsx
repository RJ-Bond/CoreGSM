/**
 * «Сообщество»: the public showcase. Players online now with the hour's trend and the record, how many people play
 * (against the period before), when the community plays and the best time to join, who plays what and where, the
 * seasons, the most active players (day / week / month / all time) with a podium and a search, the live feed,
 * the gallery and the servers. A sticky strip of chips jumps between the blocks.
 */
import { useEffect, useMemo, useState, type PointerEvent } from 'react';
import { api, type PlayerProfile, type Server } from '../api';
import { useAuth } from '../auth';
import { gameColor, gameLabel } from '../games';
import { busiestText, DOW_SHORT, FeedItem, HeatLegend, MiniHeat, PlayerAvatar, useCommunityLive, type Community, type TopPlayer } from '../components/servers/CommunityBento';
import { AnimatedNumber, CopyButton, Empty, GameAvatar, MiniSpark, PageHead, ago, fmtDate, fmtDateTime, navigate, plural, num } from '../ui';
import '../styles/analytics.css';
import '../styles/community.css';
import '../styles/gallery.css';
import { Lightbox, type Shot } from './Gallery';

const IconPeople = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.6c2.6.2 4.5 2 4.5 4.9" />
  </svg>
);

/** a small drawing for the empty blocks: a few people */
const PeopleArt = () => (
  <svg width="120" height="84" viewBox="0 0 120 84" fill="none" aria-hidden>
    <circle cx="60" cy="26" r="13" fill="rgb(var(--brand) / .22)" stroke="rgb(var(--brand))" strokeWidth="2.5" />
    <path d="M34 74c0-14 11.600-24 26-24s26 10 26 24" fill="rgb(var(--brand) / .12)" stroke="rgb(var(--brand))" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="25" cy="36" r="8" stroke="rgb(var(--mute))" strokeWidth="2" opacity=".6" />
    <circle cx="95" cy="36" r="8" stroke="rgb(var(--mute))" strokeWidth="2" opacity=".6" />
    <path d="M10 70c0-8 6-13 15-13M110 70c0-8-6-13-15-13" stroke="rgb(var(--mute))" strokeWidth="2" strokeLinecap="round" opacity=".6" />
  </svg>
);

interface Top { name: string; hours: number; servers: number }
export interface Seasons {
  current: { id: number; name: string; startsAt: number; top: Top[]; first: { name: string; at: number } | null } | null;
  past: { id: number; name: string; startsAt: number; endsAt: number; podium: Top[]; first: { name: string; at: number } | null }[];
}

const MEDALS = ['🥇', '🥈', '🥉'];
const playerHref = (n: string) => `/player/${encodeURIComponent(n)}`;
const localNow = () => { const d = new Date(); return { dow: (d.getDay() + 6) % 7, hour: d.getHours() }; };
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** my game nick (empty while unknown or when I am not signed in) */
function useMyNick(): string {
  const { me } = useAuth();
  const [nick, setNick] = useState('');
  useEffect(() => {
    if (!me) { setNick(''); return; }
    api<PlayerProfile>('/me/player').then((p) => setNick(p.gameNick?.trim() ?? '')).catch(() => setNick(''));
  }, [me]);
  return nick;
}

/** «▲ 12%» against the period before */
function Delta({ now, prev }: { now: number; prev: number }) {
  if (now === 0 && prev === 0) return null;
  const up = now >= prev;
  const text = prev > 0 ? `${up ? '+' : '−'}${Math.abs(Math.round(((now - prev) / prev) * 100))}%` : `+${now}`;
  if (now === prev) return <span className="cm-delta" title="Столько же, сколько в прошлом периоде">=</span>;
  return <span className={`cm-delta ${up ? 'up' : 'down'}`} title={`В прошлом периоде: ${prev}`}><span aria-hidden>{up ? '▲' : '▼'}</span> {text}</span>;
}

/** a little line chart with a cursor and a tooltip; `values` are equally spaced, null = no data */
function TinyChart({ values, label, mark, color = 'rgb(var(--brand))', className = '' }: { values: (number | null)[]; label: (i: number) => string; mark?: number | null; color?: string; className?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 300, H = 64, pad = 4;
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const n = values.length;
  const X = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2);
  const Y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  let line = '';
  let area = '';
  let open: number[] = [];
  const flush = () => {
    if (open.length > 1) area += `M${X(open[0]).toFixed(1)} ${H}${open.map((i) => `L${X(i).toFixed(1)} ${Y(values[i] as number).toFixed(1)}`).join('')}L${X(open[open.length - 1]).toFixed(1)} ${H}Z`;
    open = [];
  };
  values.forEach((v, i) => {
    if (v == null) { flush(); return; }
    line += `${open.length ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`;
    open.push(i);
  });
  flush();
  const near = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    setHover(Math.round(x * (n - 1)));
  };
  const hv = hover != null ? values[hover] : null;
  const gid = useMemo(() => `cg${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <div className={`cm-chart ${className}`} style={{ color }} onPointerMove={near} onPointerDown={near} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-hidden>
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".3" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {mark != null && mark >= 0 && mark < n && <span className="cm-chart-mark" style={{ left: `${(X(mark) / W) * 100}%` }} aria-hidden />}
      {hover != null && (
        <>
          <span className="cm-chart-cur" style={{ left: `${(X(hover) / W) * 100}%` }} aria-hidden />
          <span className="cm-chart-tip" style={{ left: `${Math.max(14, Math.min(86, (X(hover) / W) * 100))}%` }} role="status"><b>{hv == null ? '–' : num(Math.round(hv * 10) / 10)}</b> · {label(hover)}</span>
        </>
      )}
    </div>
  );
}

/** the greeting of a signed-in player: today's hours and the streak */
function Greeting() {
  const { me } = useAuth();
  const nick = useMyNick();
  const [card, setCard] = useState<{ hours: number; streak: number; online: boolean; recent: { from: number; to: number | null }[] } | null | undefined>(undefined);
  useEffect(() => {
    if (!nick) { setCard(undefined); return; }
    api<{ hours: number; streak: number; online: boolean; recent: { from: number; to: number | null }[] }>(`/players/${encodeURIComponent(nick)}`).then(setCard).catch(() => setCard(null));
  }, [nick]);
  if (!me) return null;
  const midnight = new Date().setHours(0, 0, 0, 0);
  const today = card ? card.recent.reduce((n, v) => n + Math.max(0, (v.to ?? Date.now()) - Math.max(v.from, midnight)), 0) / 3_600_000 : 0;
  return (
    <section className="tile cm-greet fade-in" aria-label="Ваша активность">
      <PlayerAvatar name={nick || me.username} size={40} online={!!card?.online} />
      <div className="min-w-0 flex-1">
        <div className="font-extrabold">Привет, {me.username}!</div>
        <div className="text-sm font-semibold text-mute">
          {!nick ? 'Укажите игровой ник в профиле, и здесь появятся ваши часы.' : card === null ? `Ник ${nick} пока не встречался на серверах.` : card === undefined ? 'Считаю ваши часы…' : today > 0.01 ? `Сегодня вы уже сыграли ${num(Math.round(today * 10) / 10)} ч${card.streak > 1 ? `, серия ${card.streak} ${plural(card.streak, ['день', 'дня', 'дней'])} подряд` : ''}.` : 'Сегодня вы ещё не играли.'}
        </div>
      </div>
      <a href={nick && card ? playerHref(nick) : '/profile'} className="btn btn-soft btn-sm">{nick && card ? 'Моя карточка' : 'Профиль'}</a>
    </section>
  );
}

/** the current season's leaderboard and the hall of fame of the finished ones */
function SeasonBlocks({ s, mine }: { s: Seasons; mine: string }) {
  const cur = s.current;
  const days = cur ? Math.max(1, Math.ceil((Date.now() - cur.startsAt) / 86_400_000)) : 0;
  const maxH = Math.max(1, ...(cur?.top ?? []).map((p) => p.hours));
  const myIdx = cur && mine ? cur.top.findIndex((p) => p.name.toLowerCase() === mine.toLowerCase()) : -1;
  return (
    <>
      {cur && (
        <section id="cm-season" className="tile cm-season fade-in p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-extrabold">🏁 {cur.name}</h2>
            <span className="text-sm font-bold text-mute">идёт {days} {plural(days, ['день', 'дня', 'дней'])}, с {fmtDate(cur.startsAt)}</span>
          </div>
          {mine && <p className={`cm-me ${myIdx < 0 ? 'is-out' : ''}`}>{myIdx >= 0 ? `Вы на ${myIdx + 1} месте в сезоне: ${num(cur.top[myIdx].hours)} ч` : `Вас пока нет в десятке сезона, ник ${mine}`}</p>}
          {cur.top.length === 0 ? <p className="cm-sub">В этом сезоне ещё никто не играл: станьте первым.</p> : (
            <ol className="an-top">
              {cur.top.map((p, i) => (
                <li key={p.name} className={i === myIdx ? 'is-me' : ''}>
                  <span className={`an-top-n ${i < 3 ? `is-${i + 1}` : ''}`}>{i + 1}</span>
                  <PlayerAvatar name={p.name} size={30} />
                  <span className="min-w-0 flex-1">
                    <a href={playerHref(p.name)} className="block truncate font-extrabold hover:text-link">{p.name}</a>
                    <span className="an-top-bar"><span style={{ width: `${(p.hours / maxH) * 100}%`, background: 'rgb(var(--warn-fill))' }} /></span>
                  </span>
                  <span className="shrink-0 font-extrabold tabular-nums">{num(p.hours)} ч</span>
                </li>
              ))}
            </ol>
          )}
          {cur.first && <p className="cm-sub">Первым в сезоне зашёл <a href={playerHref(cur.first.name)} className="text-ink hover:text-link">{cur.first.name}</a>, {fmtDateTime(cur.first.at)}</p>}
        </section>
      )}
      {s.past.length > 0 && (
        <section className="tile p-4 sm:p-5">
          <h2 className="mb-3 text-lg font-extrabold">🏆 Зал славы</h2>
          <ul className="cm-fame">
            {s.past.map((x) => (
              <li key={x.id} className="cm-fame-i">
                <div className="font-extrabold">{x.name}</div>
                <div className="text-xs font-bold text-mute">{fmtDate(x.startsAt)} – {fmtDate(x.endsAt)}</div>
                <ol className="mt-2 grid gap-1.5">
                  {x.podium.map((p, i) => (
                    <li key={p.name} className="flex items-center gap-2">
                      <span aria-label={`${i + 1} место`}>{MEDALS[i]}</span>
                      <PlayerAvatar name={p.name} size={26} />
                      <a href={playerHref(p.name)} className="min-w-0 flex-1 truncate font-bold hover:text-link">{p.name}</a>
                      <span className="text-sm font-extrabold tabular-nums text-mute">{num(p.hours)} ч</span>
                    </li>
                  ))}
                  {x.podium.length === 0 && <li className="text-sm font-semibold text-mute">Никто не играл</li>}
                </ol>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** when the community plays: the heat map with «now» marked, the typical day of a weekday and the best time to join */
function WhenBlock({ c }: { c: Community }) {
  const here = localNow();
  const [dow, setDow] = useState(here.dow);
  const row = c.heatmap.cells[dow] ?? [];
  let best: { h: number; sum: number } | null = null;
  for (let h = 0; h < 23; h++) {
    const a = row[h], b = row[h + 1];
    if (a != null && b != null && (!best || a + b > best.sum)) best = { h, sum: a + b };
  }
  const peak = best ? `${hh(best.h)}–${hh(best.h + 2)}` : null;
  const inPeak = !!best && dow === here.dow && here.hour >= best.h && here.hour <= best.h + 1;
  return (
    <section id="cm-when" className="tile p-4 sm:p-5">
      <h2 className="mb-3 text-lg font-extrabold">Когда играет сообщество</h2>
      {peak ? (
        <p className={`cm-best ${inPeak ? 'is-now' : ''}`}>
          <span aria-hidden>🕗</span>
          {dow === here.dow ? <>Сегодня лучшее время зайти: <b>{peak}</b>{inPeak ? '. Сейчас как раз пик.' : ''}</> : <>В {DOW_SHORT[dow]} людей больше всего около <b>{peak}</b></>}
        </p>
      ) : null}
      <MiniHeat cells={c.heatmap.cells} big now={here} />
      <HeatLegend />
      <p className="cm-sub">{busiestText(c.heatmap.busiest)}. Средние за 30 дней по всем серверам. Рамкой отмечен текущий час.</p>
      <div className="cm-days" role="group" aria-label="Типичный день">
        {DOW_SHORT.map((d, i) => <button key={d} type="button" className="seg-item" aria-pressed={dow === i} onClick={() => setDow(i)}>{d}</button>)}
      </div>
      <TinyChart values={row} label={(i) => `${DOW_SHORT[dow]} ${hh(i)}`} mark={dow === here.dow ? here.hour : null} className="cm-chart-day" />
      <div className="cm-chart-ticks" aria-hidden><span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
    </section>
  );
}

/** who plays what now: one stacked bar by game */
function GamesShare({ servers }: { servers: Community['servers'] }) {
  const by = new Map<string, number>();
  for (const s of servers) if (s.online && s.players > 0) by.set(s.game, (by.get(s.game) ?? 0) + s.players);
  const list = [...by].sort((a, b) => b[1] - a[1]);
  const total = list.reduce((n, [, v]) => n + v, 0);
  return (
    <section className="tile p-4 sm:p-5">
      <h2 className="mb-3 text-lg font-extrabold">Кто во что играет</h2>
      {total === 0 ? <p className="cm-sub">Сейчас на серверах никого нет.</p> : (
        <>
          <div className="cm-share" role="img" aria-label={list.map(([g, v]) => `${gameLabel(g)}: ${v}`).join(', ')}>
            {list.map(([g, v]) => <span key={g} style={{ width: `${(v / total) * 100}%`, background: gameColor(g) }} title={`${gameLabel(g)}: ${v}`} />)}
          </div>
          <ul className="cm-share-legend">
            {list.map(([g, v]) => (
              <li key={g}><i style={{ background: gameColor(g) }} aria-hidden /><span className="truncate font-bold">{gameLabel(g)}</span><span className="ml-auto font-extrabold tabular-nums">{v}</span><span className="w-10 text-right text-xs font-bold text-mute">{Math.round((v / total) * 100)}%</span></li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** the busiest server now, with a button that copies its address */
function HotServer({ servers }: { servers: Community['servers'] }) {
  const [all, setAll] = useState<Server[] | null>(null);
  useEffect(() => { api<Server[]>('/servers').then(setAll).catch(() => setAll([])); }, []);
  const hot = servers.find((s) => s.online && s.players > 0);
  const addr = hot ? all?.find((x) => x.id === hot.id)?.address : undefined;
  return (
    <section className="tile cm-hot p-4 sm:p-5">
      <h2 className="mb-3 text-lg font-extrabold">Самый людный сервер</h2>
      {!hot ? <p className="cm-sub">Сейчас все серверы пусты.</p> : (
        <div className="flex items-center gap-3">
          <GameAvatar game={hot.game} size={48} />
          <div className="min-w-0 flex-1">
            <a href={`/servers/${hot.id}`} className="block truncate text-lg font-extrabold hover:text-link">{hot.name}</a>
            <div className="text-sm font-bold text-mute"><AnimatedNumber value={hot.players} />{hot.maxPlayers ? ` из ${hot.maxPlayers}, ${Math.round((hot.players / hot.maxPlayers) * 100)}%` : ''} · {gameLabel(hot.game)}</div>
            {addr && <code className="mt-0.5 block truncate font-mono text-xs font-semibold text-mute">{addr}</code>}
          </div>
          {addr && <CopyButton text={addr} label="Скопировать адрес" />}
        </div>
      )}
    </section>
  );
}

const PERIODS = [['day', 'Сутки'], ['week', 'Неделя'], ['month', 'Месяц'], ['all', 'Всё время']] as const;
type Period = (typeof PERIODS)[number][0];

/** the change of the place against the period before */
function Move({ p, i, period }: { p: TopPlayer; i: number; period: Period }) {
  if (period === 'all') return null;
  if (p.prev == null) return <span className="cm-move new" title="Не было в топе прошлого периода">новый</span>;
  const d = p.prev - (i + 1);
  if (d === 0) return <span className="cm-move" title="Место не изменилось">=</span>;
  return <span className={`cm-move ${d > 0 ? 'up' : 'down'}`} title={`Раньше было ${p.prev} место`}><span aria-hidden>{d > 0 ? '▲' : '▼'}</span>{Math.abs(d)}</span>;
}

/** the most active players: a period switch, a podium, the rest as a list, «show more» and a search by nick */
function TopBlock({ c, mine }: { c: Community; mine: string }) {
  const [period, setPeriod] = useState<Period>('week');
  const [more, setMore] = useState(false);
  const [q, setQ] = useState('');
  const items = c.top[period];
  const shown = more ? items : items.slice(0, 10);
  const maxH = Math.max(1, ...items.map((p) => p.hours));
  const podium = shown.length >= 3 ? shown.slice(0, 3) : [];
  const rest = podium.length ? shown.slice(3) : shown;
  const names = useMemo(() => [...new Set([...Object.values(c.top).flat().map((p) => p.name), ...c.feed.map((f) => f.name)])], [c]);
  const go = (e: { preventDefault: () => void }) => { e.preventDefault(); const n = q.trim(); if (n) navigate(playerHref(n)); };
  const row = (p: TopPlayer, i: number) => (
    <li key={p.name} className={mine && p.name.toLowerCase() === mine.toLowerCase() ? 'is-me' : ''}>
      <span className={`an-top-n ${i < 3 ? `is-${i + 1}` : ''}`}>{i + 1}</span>
      <PlayerAvatar name={p.name} size={32} online={p.online} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2"><a href={playerHref(p.name)} className="truncate font-extrabold hover:text-link">{p.name}</a><Move p={p} i={i} period={period} /></span>
        <span className="an-top-bar"><span style={{ width: `${(p.hours / maxH) * 100}%`, background: 'rgb(var(--brand))' }} /></span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-extrabold tabular-nums">{num(p.hours)} ч</span>
        <span className="block text-xs font-bold text-mute">{p.servers} {plural(p.servers, ['сервер', 'сервера', 'серверов'])}</span>
      </span>
    </li>
  );
  return (
    <section id="cm-top" className="tile p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold">Самые активные</h2>
        <div className="seg" role="group" aria-label="Период">
          {PERIODS.map(([id, label]) => <button key={id} type="button" className="seg-item" aria-pressed={period === id} onClick={() => { setPeriod(id); setMore(false); }}>{label}</button>)}
        </div>
      </div>
      <form className="cm-search" onSubmit={go} role="search">
        <input className="input" type="search" list="cm-names" placeholder="Найти игрока по нику…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Найти игрока по нику" maxLength={64} />
        <datalist id="cm-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
        <button type="submit" className="btn btn-soft" disabled={!q.trim()}>Открыть</button>
      </form>
      {items.length === 0 ? (
        <Empty art={<PeopleArt />} title="Пока тихо" text={period === 'day' ? 'За сутки никто не играл. Загляните позже.' : 'Здесь появятся самые активные игроки.'} />
      ) : (
        <>
          {podium.length === 3 && (
            <div className="cm-podium">
              {[1, 0, 2].map((i) => {
                const p = podium[i];
                return (
                  <a key={p.name} href={playerHref(p.name)} className={`cm-pod is-${i + 1}`}>
                    <span aria-hidden className="text-xl">{MEDALS[i]}</span>
                    <PlayerAvatar name={p.name} size={i === 0 ? 52 : 42} online={p.online} />
                    <span className="max-w-full truncate font-extrabold">{p.name}</span>
                    <span className="text-sm font-extrabold tabular-nums text-mute">{num(p.hours)} ч</span>
                    <Move p={p} i={i} period={period} />
                  </a>
                );
              })}
            </div>
          )}
          {rest.length > 0 && <ol className="an-top" start={podium.length + 1}>{rest.map((p, i) => row(p, i + podium.length))}</ol>}
          {items.length > 10 && (
            <button type="button" className="btn btn-soft mt-3" onClick={() => setMore((v) => !v)}>{more ? 'Свернуть' : `Показать ещё ${items.length - 10}`}</button>
          )}
        </>
      )}
    </section>
  );
}

type FeedFilter = 'all' | 'new' | 'online';

/** the live feed: filters and groups by time */
function FeedBlock({ c, filter, setFilter }: { c: Community; filter: FeedFilter; setFilter: (f: FeedFilter) => void }) {
  const list = c.feed.filter((f) => (filter === 'new' ? f.newcomer : filter === 'online' ? f.online : true));
  const midnight = new Date().setHours(0, 0, 0, 0);
  const groups: [string, typeof list][] = [];
  for (const f of list) {
    const label = Date.now() - f.at < 3_600_000 ? 'Последний час' : f.at >= midnight ? 'Сегодня' : 'Раньше';
    const g = groups.find((x) => x[0] === label);
    if (g) g[1].push(f); else groups.push([label, [f]]);
  }
  return (
    <section id="cm-feed" className="tile p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold">Живая лента</h2>
        <div className="seg" role="group" aria-label="Фильтр ленты">
          {([['all', 'Все'], ['online', 'В игре'], ['new', 'Новички']] as [FeedFilter, string][]).map(([id, label]) => <button key={id} type="button" className="seg-item" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
        </div>
      </div>
      {c.feed.length === 0 ? <Empty art={<PeopleArt />} title="Пока никто не заходил" text="Заходы игроков появятся здесь сами." />
        : list.length === 0 ? <p className="cm-sub">{filter === 'new' ? 'Новичков среди последних заходов нет.' : 'Из последних заходов никого нет в игре.'}</p>
        : groups.map(([label, items]) => (
          <div key={label} className="cm-feed-group">
            <h3 className="cm-feed-h">{label}</h3>
            <ul className="cm-feed-list">{items.map((f) => <FeedItem key={`${f.name}-${f.at}`} f={f} />)}</ul>
          </div>
        ))}
    </section>
  );
}

/** the latest screenshots: the first one large */
function GalleryStrip() {
  const [list, setList] = useState<Shot[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { api<Shot[]>('/gallery?limit=6').then(setList).catch(() => setList([])); }, []);
  return (
    <section id="cm-gallery" className="tile p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold">Галерея</h2>
        <a href="/gallery" className="text-sm font-extrabold text-link hover:underline">{list?.length ? 'Вся галерея →' : 'Загрузить скриншот →'}</a>
      </div>
      {list === null ? <div className="skeleton h-48 rounded-2xl" />
        : list.length === 0 ? <Empty art={<PeopleArt />} title="Скриншотов пока нет" text="Поделитесь первым кадром из игры."><a href="/gallery" className="btn">Загрузить</a></Empty>
        : (
          <ul className={`cm-gal n${Math.min(list.length, 5)}`}>
            {list.slice(0, 5).map((s, i) => (
              <li key={s.id} className={i === 0 && list.length >= 3 ? 'is-big' : ''}>
                <button type="button" className="gl-shot" onClick={() => setOpen(i)} aria-label={s.caption || `Скриншот ${i + 1}`}>
                  <img src={s.thumb} alt="" loading="lazy" />
                  {s.featured && <span className="gl-star" title="Лучшее">★</span>}
                  {(s.caption || s.author) && (
                    <span className="gl-cap">
                      {s.caption && <span className="block truncate font-extrabold">{s.caption}</span>}
                      <span className="block truncate text-xs font-bold opacity-80">{[s.author, s.serverName].filter(Boolean).join(' · ')}</span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      {open !== null && list && <Lightbox list={list} index={open} onClose={() => setOpen(null)} onIndex={setOpen} />}
    </section>
  );
}

type SrvSort = 'players' | 'fill' | 'name';

/** the servers: sort, filter by game, a curve of the day in every row; servers that are down go last */
function ServersBlock({ servers }: { servers: Community['servers'] }) {
  const [sort, setSort] = useState<SrvSort>('players');
  const [game, setGame] = useState('');
  const games = [...new Set(servers.map((s) => s.game))];
  const fill = (s: Community['servers'][number]) => (s.maxPlayers ? s.players / s.maxPlayers : 0);
  const list = servers
    .filter((s) => !game || s.game === game)
    .sort((a, b) => Number(b.online) - Number(a.online) || (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'fill' ? fill(b) - fill(a) : b.players - a.players));
  const maxP = Math.max(1, ...servers.map((s) => s.players));
  return (
    <section id="cm-servers" className="tile p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold">Где играют сейчас</h2>
        <div className="seg" role="group" aria-label="Сортировка">
          {([['players', 'По игрокам'], ['fill', 'По заполнению'], ['name', 'По имени']] as [SrvSort, string][]).map(([id, label]) => <button key={id} type="button" className="seg-item" aria-pressed={sort === id} onClick={() => setSort(id)}>{label}</button>)}
        </div>
      </div>
      {games.length > 1 && (
        <div className="cm-chips" role="group" aria-label="Игра">
          <button type="button" className="cm-chip" aria-pressed={!game} onClick={() => setGame('')}>Все</button>
          {games.map((g) => <button key={g} type="button" className="cm-chip" aria-pressed={game === g} onClick={() => setGame(g)}><i style={{ background: gameColor(g) }} aria-hidden />{gameLabel(g)}</button>)}
        </div>
      )}
      {list.length === 0 ? <Empty art={<PeopleArt />} title="Серверов нет" text="Когда серверы добавят, они появятся здесь." /> : (
        <ul className="grid gap-2.5">
          {list.map((s) => (
            <li key={s.id}>
              <a href={`/servers/${s.id}`} className={`cm-srv ${s.online ? '' : 'is-off'}`}>
                <GameAvatar game={s.game} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-extrabold">{s.name}</span>
                  <span className="cm-srv-bar"><span style={{ width: `${(s.players / maxP) * 100}%` }} /></span>
                </span>
                <span className="cm-srv-spark max-sm:hidden">{s.online ? <MiniSpark serverId={s.id} color={gameColor(s.game)} /> : null}</span>
                <span className="shrink-0 text-right font-extrabold tabular-nums">
                  {s.online ? <>{s.players}{s.maxPlayers ? ` / ${s.maxPlayers}` : ''}{s.maxPlayers ? <span className="block text-xs font-bold text-mute">{Math.round(fill(s) * 100)}%</span> : null}</> : <span className="text-bad">не в сети</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** the strip of chips under the title: jumps to a block and lights the one in view */
function SectionNav({ items }: { items: [string, string][] }) {
  const [cur, setCur] = useState(items[0]?.[0] ?? '');
  const key = items.map((i) => i[0]).join(',');
  useEffect(() => {
    const els = items.map(([id]) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    if (!('IntersectionObserver' in window) || els.length === 0) return;
    const seen = new Map<string, number>();
    const io = new IntersectionObserver((es) => {
      for (const e of es) seen.set(e.target.id, e.isIntersecting ? e.boundingClientRect.top : Infinity);
      const best = [...seen].filter(([, v]) => v !== Infinity).sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))[0];
      if (best) setCur(best[0]);
    }, { rootMargin: '-90px 0px -55% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    setCur(id);
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };
  return (
    <nav className="cm-nav" aria-label="Разделы страницы">
      {items.map(([id, label]) => <button key={id} type="button" className="cm-nav-i" aria-current={cur === id ? 'true' : undefined} onClick={() => go(id)}>{label}</button>)}
    </nav>
  );
}

function CommunitySkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Загрузка">
      <PageHead icon={<IconPeople />} title="Сообщество" subtitle="Кто играет, когда и где" />
      <div className="tile skeleton h-40" />
      <div className="tile p-5"><div className="skeleton mb-3 h-6 w-56 rounded-lg" /><div className="skeleton h-40 rounded-2xl" /></div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="tile p-5"><div className="skeleton mb-3 h-6 w-40 rounded-lg" />{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton mb-2 h-10 rounded-xl" />)}</div>
        <div className="tile p-5"><div className="skeleton mb-3 h-6 w-40 rounded-lg" />{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton mb-2 h-10 rounded-xl" />)}</div>
      </div>
      <div className="tile skeleton h-56" />
    </div>
  );
}

export default function CommunityPage() {
  const { data: c, at, busy, refresh } = useCommunityLive();
  const [seasons, setSeasons] = useState<Seasons | null>(null);
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const mine = useMyNick();
  useEffect(() => { api<Seasons>('/seasons').then(setSeasons).catch(() => undefined); }, []);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(id); }, []);
  if (!c) return <CommunitySkeleton />;

  const hasSeason = !!seasons && (!!seasons.current || seasons.past.length > 0);
  const maxSeries = c.series;
  const last = maxSeries[maxSeries.length - 1];
  const hourAgo = maxSeries.length >= 3 ? maxSeries[maxSeries.length - 3] : null;
  const trend = last && hourAgo ? Math.round(last.players - hourAgo.players) : null;
  const rec = c.record;
  const isRecord = !!rec && c.now.players > 0 && c.now.players >= rec.players;
  const toRecord = rec ? Math.min(1, c.now.players / Math.max(1, rec.players)) : 0;
  const showFeed = (f: FeedFilter) => { setFeedFilter(f); document.getElementById('cm-feed')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  const nav: [string, string][] = [
    ['cm-now', 'Сейчас'],
    ...(hasSeason ? [['cm-season', 'Сезон'] as [string, string]] : []),
    ['cm-when', 'Активность'],
    ['cm-top', 'Топ'],
    ['cm-feed', 'Лента'],
    ['cm-gallery', 'Галерея'],
    ['cm-servers', 'Серверы'],
  ];

  return (
    <div className="space-y-5">
      <PageHead icon={<IconPeople />} title="Сообщество" subtitle="Кто играет, когда и где: живые цифры всех серверов">
        <button type="button" className="cm-refresh" onClick={refresh} aria-busy={busy || undefined} title="Данные обновляются сами. Нажмите, чтобы обновить сейчас">
          <span className="live-dot" aria-hidden />
          {busy ? 'обновляю…' : `обновлено ${ago(at)}`}
        </button>
      </PageHead>
      <SectionNav items={nav} />

      <Greeting />

      <section id="cm-now" className="tile cm-hero fade-in">
        <div className="cm-hero-main">
          <div className="cm-k">Сейчас в игре</div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <AnimatedNumber value={c.now.players} className="cm-hero-n" pulse />
            <span className="text-lg font-extrabold text-mute">{plural(c.now.players, ['игрок', 'игрока', 'игроков'])} на {c.now.online} {plural(c.now.online, ['сервере', 'серверах', 'серверах'])}</span>
            {trend != null && trend !== 0 && <span className={`cm-delta ${trend > 0 ? 'up' : 'down'}`} title="Против часа назад"><span aria-hidden>{trend > 0 ? '▲' : '▼'}</span> {trend > 0 ? '+' : '−'}{Math.abs(trend)} за час</span>}
          </div>
          {rec && (
            <>
              <div className="cm-meter" aria-hidden><span style={{ width: `${toRecord * 100}%` }} /></div>
              <p className="cm-sub">
                {isRecord ? '🎉 Это рекорд за 30 дней!' : <>До рекорда <b className="text-ink">{Math.max(0, rec.players - c.now.players)}</b> {plural(Math.max(0, rec.players - c.now.players), ['игрок', 'игрока', 'игроков'])}. Рекорд за 30 дней: <b className="text-ink">{rec.players}</b>, {fmtDateTime(rec.at)}</>}
              </p>
            </>
          )}
          {c.series.length > 2 && <TinyChart values={c.series.map((p) => p.players)} label={(i) => new Date(c.series[i].ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} mark={c.series.length - 1} className="cm-chart-hero" />}
          {c.series.length > 2 && <div className="cm-chart-ticks" aria-hidden><span>24 ч назад</span><span>сейчас</span></div>}
        </div>
        <dl className="cm-hero-stats">
          <div><dt>За сутки</dt><dd><AnimatedNumber value={c.players.day} /></dd><Delta now={c.players.day} prev={c.players.prev.day} /></div>
          <div><dt>За неделю</dt><dd><AnimatedNumber value={c.players.week} /></dd><Delta now={c.players.week} prev={c.players.prev.week} /></div>
          <div><dt>За месяц</dt><dd><AnimatedNumber value={c.players.month} /></dd><Delta now={c.players.month} prev={c.players.prev.month} /></div>
          <div>
            <dt>Новых за неделю</dt>
            <dd>{c.players.newWeek > 0 ? <button type="button" className="cm-stat-link" onClick={() => showFeed('new')} title="Показать новичков в ленте"><AnimatedNumber value={c.players.newWeek} /></button> : 0}</dd>
            <Delta now={c.players.newWeek} prev={c.players.prev.newWeek} />
          </div>
        </dl>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <HotServer servers={c.servers} />
        <GamesShare servers={c.servers} />
      </div>

      {seasons && hasSeason && <SeasonBlocks s={seasons} mine={mine} />}

      <WhenBlock c={c} />

      <TopBlock c={c} mine={mine} />

      <FeedBlock c={c} filter={feedFilter} setFilter={setFeedFilter} />

      <GalleryStrip />

      <ServersBlock servers={c.servers} />
    </div>
  );
}
