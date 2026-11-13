// Pieces of the servers page: reactions to changes, capacity bar, empty states, skeletons.
import { useAppearance } from '../../appearance';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Server } from '../../api';
import { StateView } from '../StateView';
import { t, useI18n } from '../../i18n';
import { capLevel, capacityPct, slotsInfo } from './capacity';
import { toast, useHourTrend } from '../../ui';
import { haptic } from '../../ui/haptic';
import { EmptyRackArt, NoFavsArt, NoMatchArt } from './ServersArt';
import { CardSeat, CardUsers } from './CardIcons';
import { PlayerAvatar } from './CommunityBento';

// ---------- reactions to changes (item 29) ----------
export interface Reaction {
  /** last change of the player count (0 = nothing to show) and a counter that restarts the animation */
  d: number;
  dk: number;
  /** the server went offline ('down') or came back ('up') */
  st: 'up' | 'down' | null;
  sk: number;
}
export type Reactions = Record<number, Reaction>;
const NONE: Reaction = { d: 0, dk: 0, st: null, sk: 0 };
export const reactionOf = (rx: Reactions, id: number): Reaction => rx[id] ?? NONE;

/**
 * Compares every poll with the previous one (kept in a ref) and reports what changed.
 * Nothing is reported for the first load. The reaction disappears by itself after a couple of seconds.
 */
export function useServerReactions(servers: Server[], loaded: boolean): Reactions {
  const prev = useRef<Map<number, { players: number; online: boolean; known: boolean }> | null>(null);
  const [rx, setRx] = useState<Reactions>({});
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  useEffect(() => {
    if (!loaded) return;
    const before = prev.current;
    prev.current = new Map(servers.map((s) => [s.id, { players: s.players, online: s.online, known: s.hasStatus }]));
    if (!before) return;
    const patches: [number, Partial<Reaction>][] = [];
    for (const s of servers) {
      const p = before.get(s.id);
      if (!p) continue;
      if (p.known && s.hasStatus && p.online !== s.online) patches.push([s.id, { st: s.online ? 'up' : 'down', d: 0 }]);
      else if (s.online && p.online && p.players !== s.players) patches.push([s.id, { d: s.players - p.players }]);
    }
    if (patches.length === 0) return;
    setRx((cur) => {
      const next = { ...cur };
      for (const [id, patch] of patches) {
        const c = next[id] ?? NONE;
        next[id] = { ...c, ...patch, dk: patch.d ? c.dk + 1 : c.dk, sk: patch.st ? c.sk + 1 : c.sk };
        const { dk, sk } = next[id];
        timers.current.push(window.setTimeout(() => {
          setRx((r) => {
            const x = r[id];
            if (!x) return r;
            const n = { ...x };
            if (patch.d && x.dk === dk) n.d = 0;
            if (patch.st && x.sk === sk) n.st = null;
            return { ...r, [id]: n };
          });
        }, 2400));
      }
      return next;
    });
  }, [servers, loaded]);
  return rx;
}

/** wraps a status pill: flashes red / green once (box-shadow only) */
export function StatusFlash({ r, children }: { r: Reaction; children: ReactNode }) {
  return <span key={r.st ? r.sk : 'idle'} className={`srv-status ${r.st === 'down' ? 'srv-flash-bad' : r.st === 'up' ? 'srv-flash-ok' : ''}`}>{children}</span>;
}

/** wraps a player count: the number is highlighted and a «+1» / «−2» chip fades out */
export function CountReact({ r, onDark = false, children }: { r: Reaction; onDark?: boolean; children: ReactNode }) {
  const dir = r.d > 0 ? 'up' : r.d < 0 ? 'down' : '';
  return (
    <span key={dir ? r.dk : 'idle'} className={`srv-num ${dir ? `srv-num-${dir}` : ''} ${onDark ? 'on-dark' : ''}`}>
      {children}
      {dir && <span className={`srv-delta ${dir}`} aria-hidden>{r.d > 0 ? `+${r.d}` : `−${-r.d}`}</span>}
    </span>
  );
}

// ---------- capacity ----------
export { capacityPct } from './capacity';

/** «Свободно 12 мест» / «Почти полон» / «Мест нет» */
export function SlotsText({ players, max, onDark = false, big = false, className = '' }: { players: number; max: number; onDark?: boolean; big?: boolean; className?: string }) {
  useI18n();
  const info = slotsInfo(players, max);
  if (!info) return null;
  const text = info.kind === 'full' ? t('srv.slots.full') : info.kind === 'almost' ? t('srv.slots.almost') : t('srv.slots.free', { n: info.free });
  return (
    <span className={`srv-slots ${info.kind} ${onDark ? 'on-dark' : ''} ${big ? 'big' : ''} ${className}`} title={info.kind === 'almost' ? t('srv.slots.freeOf', { n: info.free }) : undefined}>
      <CardSeat />{text}
    </span>
  );
}

export function CapacityBar({ players, max, color, onDark = false, big = false, showPct = true, slots = true, className = '' }: { players: number; max: number; color: string; onDark?: boolean; big?: boolean; showPct?: boolean; slots?: boolean; className?: string }) {
  const pct = capacityPct(players, max);
  const level = capLevel(pct);
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-2">
        <div
          className={`srv-cap ${onDark ? 'on-dark' : ''} ${level} ${big ? 'big' : ''}`}
          style={{ ['--cap' as string]: color, ...(max > 1 && max <= 40 ? { ['--slots' as string]: max } : {}) }}
          role="meter"
          aria-label={t('srv.cap.label')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          title={level === 'hot' ? t('srv.cap.nearFull', { pct }) : t('srv.cap.taken', { pct })}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
        {showPct && <span className={`srv-pct ${level} ${onDark ? 'on-dark' : ''} ${big ? 'big' : ''}`}>{pct}%</span>}
      </div>
      {slots && <SlotsText players={players} max={max} onDark={onDark} big={big} />}
    </div>
  );
}

// ---------- empty states (item 8) ----------
function EmptyState({ art, title, text, children }: { art: ReactNode; title: string; text: string; children?: ReactNode }) {
  return <StateView kind="empty" art={art} title={title} text={text}>{children}</StateView>;
}

export function NoServersState({ isAdmin }: { isAdmin: boolean }) {
  useI18n();
  return (
    <EmptyState
      art={<EmptyRackArt />}
      title={isAdmin ? t('d2.su.addFirst') : t('d2.su.noServers')}
      text={isAdmin ? t('d2.su.addFirstText') : t('d2.su.noServersText')}
    >
      {isAdmin && <a className="btn" href="/admin/servers" data-magnetic>{t('d2.dw.a.addServer')}</a>}
    </EmptyState>
  );
}

export function NoFavsState({ onReset }: { onReset: () => void }) {
  useI18n();
  return (
    <EmptyState art={<NoFavsArt />} title={t('d2.su.noFavs')} text={t('d2.su.noFavsText')}>
      <button type="button" className="btn btn-soft" onClick={onReset}>{t('d2.su.showAll')}</button>
    </EmptyState>
  );
}

export function NoMatchState({ what, onReset }: { what: 'online' | 'offline'; onReset: () => void }) {
  useI18n();
  return (
    <EmptyState
      art={<NoMatchArt />}
      title={what === 'online' ? t('d2.su.noOnline') : t('d2.su.noOffline')}
      text={what === 'online' ? t('d2.su.noOnlineText') : t('d2.su.noOfflineText')}
    >
      <button type="button" className="btn btn-soft" onClick={onReset}>{t('d2.su.resetFilter')}</button>
    </EmptyState>
  );
}

// ---------- skeletons that look like the cards ----------
const Bar = ({ w, h = 12, className = '' }: { w: number | string; h?: number; className?: string }) => (
  <div className={`skeleton rounded-full ${className}`} style={{ width: w, height: h, maxWidth: '100%' }} />
);

function SkeletonHero() {
  return (
    <div className="srv-hero srv-hero-skel tile flex min-h-[280px] flex-col gap-3 p-5 lg:p-6">
      <div className="flex items-start gap-3">
        <div className="skeleton h-12 w-12 shrink-0 rounded-2xl" />
        <div className="flex-1 space-y-2 pt-1"><Bar w="62%" h={18} /><Bar w="38%" /></div>
        <Bar w={84} h={26} />
      </div>
      <div className="flex items-end gap-3 pt-4"><Bar w={130} h={64} className="rounded-2xl!" /><Bar w={90} h={18} className="mb-2" /></div>
      <div className="skeleton skel-chart mt-auto h-20 w-full rounded-2xl" />
      <div className="flex justify-between"><Bar w={70} /><Bar w={90} /><Bar w={80} /></div>
    </div>
  );
}

function SkeletonPulse() {
  const [{ ember }] = useAppearance();
  // the Ember look: one card, four figures on the left and the curve on the right
  if (ember) {
    return (
      <div className="tile col-span-full grid gap-4 p-4 sm:grid-cols-[minmax(240px,340px)_1fr] sm:p-5">
        <div className="grid grid-cols-2 gap-2.5">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[78px] rounded-2xl" />)}</div>
        <div className="skeleton h-[140px] rounded-2xl max-sm:hidden" />
      </div>
    );
  }
  return (
    <div className="tile col-span-full flex min-h-[112px] flex-wrap items-center gap-4 p-4">
      <div className="skeleton h-11 w-11 shrink-0 rounded-2xl" />
      <div className="min-w-[160px] flex-1 space-y-2"><Bar w="55%" h={18} /><Bar w="35%" /></div>
      <div className="skeleton h-14 min-w-[180px] flex-1 rounded-2xl" />
    </div>
  );
}

function SkeletonSmall() {
  const [{ ember }] = useAppearance();
  // the Ember look: a picture across the whole top of the card, then the name, the figure, the bar
  if (ember) {
    return (
      <div className="tile flex min-h-[300px] flex-col gap-3 overflow-hidden p-0 pb-4">
        <div className="skeleton h-[136px] rounded-none" />
        <div className="space-y-2 px-[18px]"><Bar w="70%" h={16} /><Bar w="35%" /></div>
        <div className="flex items-end gap-2 px-[18px]"><Bar w={64} h={34} className="rounded-lg!" /><Bar w={40} /></div>
        <div className="px-[18px]"><Bar w="100%" h={8} /></div>
        <div className="mt-auto flex justify-between px-[18px]"><Bar w="45%" /><Bar w="18%" /></div>
      </div>
    );
  }
  return (
    <div className="tile flex min-h-[270px] flex-col gap-2 p-3 pb-4">
      <div className="skeleton h-[88px] rounded-ui-lg" />
      <div className="space-y-2 px-1.5 pt-1"><Bar w="75%" h={15} /><Bar w="40%" /></div>
      <div className="flex items-end gap-2 px-1.5 pt-1"><Bar w={54} h={30} className="rounded-lg!" /><Bar w={34} /></div>
      <div className="px-1.5"><Bar w="100%" h={6} /></div>
      <div className="mt-auto flex justify-between px-1.5"><Bar w="45%" /><Bar w="20%" /></div>
    </div>
  );
}

export function TilesSkeleton() {
  useI18n();
  return (
    <div className="srv-grid" aria-busy="true" aria-label={t('d2.news.loading')}>
      <SkeletonPulse />
      <SkeletonHero />
      {[0, 1, 2, 3].map((i) => <SkeletonSmall key={i} />)}
    </div>
  );
}

export function ListSkeleton() {
  useI18n();
  const [{ ember }] = useAppearance();
  if (ember) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label={t('d2.news.loading')}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="tile flex items-center gap-3 px-4 py-3">
            <div className="skeleton h-9 w-9 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2"><Bar w="45%" h={14} /><Bar w="22%" h={10} /></div>
            <Bar w={110} h={8} className="max-sm:hidden" />
            <Bar w={44} h={18} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="panel space-y-0 overflow-hidden p-0" aria-busy="true" aria-label={t('d2.news.loading')}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-0">
          <Bar w={84} h={24} />
          <div className="skeleton h-9 w-9 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2"><Bar w="50%" h={14} /><Bar w="25%" h={10} /></div>
          <Bar w={120} h={8} className="max-sm:hidden" />
        </div>
      ))}
    </div>
  );
}

/** the address of a server as a button: one tap copies it (the card around it is a link, so the click stays here) */
export function AddrCopy({ address, className = '' }: { address: string; className?: string }) {
  useI18n();
  const copy = async (e: { stopPropagation: () => void; preventDefault: () => void }) => {
    e.stopPropagation();
    e.preventDefault();
    try { await navigator.clipboard.writeText(address); toast(t('srv.addr.copied')); } catch { /* the address stays on screen */ }
  };
  return (
    <button type="button" className="srv-addr-copy" title={t('srv.addr.copy')} aria-label={`${t('srv.addr.copy')}: ${address}`} onClick={(e) => void copy(e)}>
      <span className={className}>{address}</span>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
    </button>
  );
}

/** four bars for the ping: the lower the ping, the more of them are lit (the colour follows the tone of the ping) */
export function PingBars({ ping, tone }: { ping: number; tone: 'ok' | 'warn' | 'bad' }) {
  const lit = ping <= 50 ? 4 : ping <= 100 ? 3 : ping <= 200 ? 2 : 1;
  return (
    <span className={`ping-bars ${tone}`} aria-hidden>
      {[1, 2, 3, 4].map((i) => <i key={i} className={i <= lit ? 'on' : ''} style={{ height: `${4 + i * 3}px` }} />)}
    </span>
  );
}

/** «▲ +3 за час»: the change of the player count in the last hour (nothing while it is flat or unknown) */
export function TrendChip({ serverId, onDark = false, className = '' }: { serverId: number; onDark?: boolean; className?: string }) {
  useI18n();
  const d = useHourTrend(serverId);
  if (d == null || d === 0) return null;
  return (
    <span className={`srv-trend ${d > 0 ? 'up' : 'down'} ${onDark ? 'on-dark' : ''} ${className}`} title={t('srv.trend.hour')}>
      <span aria-hidden>{d > 0 ? '▲' : '▼'}</span> {d > 0 ? `+${d}` : `−${-d}`} <small>{t('srv.trend.hour')}</small>
    </span>
  );
}

/** a few names of the players who are in the game now, «+N» for the rest */
export function PlayerNames({ names, max = 6, onDark = false, className = '' }: { names: string[]; max?: number; onDark?: boolean; className?: string }) {
  useI18n();
  if (names.length === 0) return null;
  return (
    <ul className={`srv-names ${onDark ? 'on-dark' : ''} ${className}`} aria-label={t('srv.who')}>
      <li className="srv-names-ico" aria-hidden="true"><CardUsers /></li>
      {names.slice(0, max).map((n, i) => <li key={`${n}-${i}`} title={n}><PlayerAvatar name={n} size={18} /><span className="truncate">{n}</span></li>)}
      {names.length > max && <li className="more">+{names.length - max}</li>}
    </ul>
  );
}

/** the first players of a server as small round pictures that overlap: the opener of the full list on a tile */
export function PlayerStack({ names, max = 3 }: { names: string[]; max?: number }) {
  if (names.length === 0) return null;
  return (
    <span className="srv-who-stack" aria-hidden>
      {names.slice(0, max).map((n, i) => <PlayerAvatar key={`${n}-${i}`} name={n} size={22} />)}
      {names.length > max && <span className="srv-who-more">+{names.length - max}</span>}
    </span>
  );
}

/** «2 ч 10 мин» for a length of time in ms */
export function durText(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return t('dur.m', { n: m });
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? t('dur.hm', { h, m: m % 60 }) : t('dur.h', { n: h });
  return t('d2.an.dShort', { n: Math.floor(h / 24) });
}

/**
 * A touch held for half a second on a card opens its «⋯» menu (copy the address, start the game, share): the touch handlers go
 * on the card, `swallow()` tells the click that follows the release to stay quiet. The menu button is found by `data-quick-menu`.
 */
export function useQuickLongPress() {
  const timer = useRef(0);
  const firedAt = useRef(0);
  const from = useRef<{ x: number; y: number } | null>(null);
  const clear = () => window.clearTimeout(timer.current);
  return {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      firedAt.current = 0;
      const el = e.currentTarget;
      const p = e.touches[0];
      from.current = p ? { x: p.clientX, y: p.clientY } : null;
      clear();
      timer.current = window.setTimeout(() => {
        const b = el.querySelector<HTMLElement>('[data-quick-menu] button');
        if (!b) return;
        firedAt.current = Date.now();
        haptic('ok');
        b.click();
      }, 520);
    },
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => {
      const p = e.touches[0];
      const s = from.current;
      if (p && s && Math.hypot(p.clientX - s.x, p.clientY - s.y) > 10) clear();
    },
    // the release after a long touch must not become a click (it would open the server and close the menu that has just opened)
    onTouchEnd: (e: React.TouchEvent<HTMLElement>) => { clear(); if (firedAt.current && e.cancelable) e.preventDefault(); },
    onTouchCancel: clear,
    onContextMenu: (e: React.MouseEvent) => { if (firedAt.current) e.preventDefault(); },
    // a click that still comes within a moment of the long touch is not a tap (the menu button's own click is one of them)
    swallow: () => firedAt.current !== 0 && Date.now() - firedAt.current < 1500,
  };
}
