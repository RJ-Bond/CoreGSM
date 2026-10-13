// Pieces of the servers page: reactions to changes, capacity bar, empty states, skeletons.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Server } from '../../api';
import { EmptyRackArt, NoFavsArt, NoMatchArt } from './ServersArt';

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
      {dir && <span className={`srv-chip ${dir}`} aria-hidden>{r.d > 0 ? `+${r.d}` : `−${-r.d}`}</span>}
    </span>
  );
}

// ---------- capacity (item 5) ----------
export const capacityPct = (players: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, Math.round((players / max) * 100))) : 0);

export function CapacityBar({ players, max, color, onDark = false, big = false, showPct = true, className = '' }: { players: number; max: number; color: string; onDark?: boolean; big?: boolean; showPct?: boolean; className?: string }) {
  const pct = capacityPct(players, max);
  const hot = pct >= 90;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        className={`srv-cap ${onDark ? 'on-dark' : ''} ${hot ? 'hot' : ''} ${big ? 'big' : ''}`}
        style={{ ['--cap' as string]: color }}
        role="meter"
        aria-label="Заполненность сервера"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        title={hot ? `Почти полный: ${pct}%` : `${pct}% мест занято`}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      {showPct && <span className={`srv-pct ${hot ? 'hot' : ''} ${onDark ? 'on-dark' : ''} ${big ? 'big' : ''}`}>{pct}%</span>}
    </div>
  );
}

// ---------- empty states (item 8) ----------
function EmptyState({ art, title, text, children }: { art: ReactNode; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="panel fade-in flex flex-col items-center gap-2 px-6 py-10 text-center">
      {art}
      <h3 className="mt-1 text-lg font-black">{title}</h3>
      <p className="max-w-sm font-semibold text-mute">{text}</p>
      {children && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  );
}

export function NoServersState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <EmptyState
      art={<EmptyRackArt />}
      title={isAdmin ? 'Добавьте первый сервер' : 'Серверов пока нет'}
      text={isAdmin ? 'Укажите игру и адрес, и панель начнёт показывать онлайн, карту и пинг. Потом привяжите Discord-канал.' : 'Администратор ещё не добавил ни одного сервера. Загляните позже: список появится здесь.'}
    >
      {isAdmin && <a className="btn" href="#/admin/servers" data-magnetic>Добавить сервер</a>}
    </EmptyState>
  );
}

export function NoFavsState({ onReset }: { onReset: () => void }) {
  return (
    <EmptyState art={<NoFavsArt />} title="В избранном пока пусто" text="Нажмите ☆ на карточке сервера, и он появится здесь и будет закреплён первым в общем списке.">
      <button type="button" className="btn btn-soft" onClick={onReset}>Показать все серверы</button>
    </EmptyState>
  );
}

export function NoMatchState({ what, onReset }: { what: 'online' | 'offline'; onReset: () => void }) {
  return (
    <EmptyState
      art={<NoMatchArt />}
      title={what === 'online' ? 'Сейчас нет серверов онлайн' : 'Недоступных серверов нет'}
      text={what === 'online' ? 'Ни один сервер не отвечает на запросы. Сбросьте фильтр, чтобы увидеть все.' : 'Все серверы отвечают. Сбросьте фильтр, чтобы увидеть полный список.'}
    >
      <button type="button" className="btn btn-soft" onClick={onReset}>Сбросить фильтр</button>
    </EmptyState>
  );
}

// ---------- skeletons that look like the cards ----------
const Bar = ({ w, h = 12, className = '' }: { w: number | string; h?: number; className?: string }) => (
  <div className={`skeleton rounded-full ${className}`} style={{ width: w, height: h, maxWidth: '100%' }} />
);

function SkeletonHero() {
  return (
    <div className="tile col-span-2 flex min-h-[280px] flex-col gap-3 p-5 lg:col-span-6 lg:row-span-2 lg:p-6">
      <div className="flex items-start gap-3">
        <div className="skeleton h-12 w-12 shrink-0 rounded-2xl" />
        <div className="flex-1 space-y-2 pt-1"><Bar w="62%" h={18} /><Bar w="38%" /></div>
        <Bar w={84} h={26} />
      </div>
      <div className="flex items-end gap-3 pt-4"><Bar w={130} h={64} className="!rounded-2xl" /><Bar w={90} h={18} className="mb-2" /></div>
      <div className="skeleton mt-auto h-20 w-full rounded-2xl" />
      <div className="flex justify-between"><Bar w={70} /><Bar w={90} /><Bar w={80} /></div>
    </div>
  );
}

function SkeletonStat() {
  return (
    <div className="tile flex min-h-[128px] flex-col gap-2 p-4 lg:col-span-3">
      <div className="flex items-start justify-between"><Bar w="50%" /><div className="skeleton h-8 w-8 rounded-xl" /></div>
      <div className="mt-auto space-y-2"><Bar w={80} h={28} className="!rounded-xl" /><Bar w="60%" /><Bar w="100%" h={6} /></div>
    </div>
  );
}

function SkeletonSmall() {
  return (
    <div className="tile col-span-2 flex min-h-[236px] flex-col gap-2 p-2.5 pb-3.5 sm:col-span-1 lg:col-span-3">
      <div className="skeleton h-[88px] rounded-[18px]" />
      <div className="space-y-2 px-1.5 pt-1"><Bar w="75%" h={15} /><Bar w="40%" /></div>
      <div className="flex items-end gap-2 px-1.5 pt-1"><Bar w={54} h={30} className="!rounded-lg" /><Bar w={34} /></div>
      <div className="px-1.5"><Bar w="100%" h={6} /></div>
      <div className="mt-auto flex justify-between px-1.5"><Bar w="45%" /><Bar w="20%" /></div>
    </div>
  );
}

export function TilesSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-12" aria-busy="true" aria-label="Загрузка">
      <SkeletonHero />
      {[0, 1, 2, 3].map((i) => <SkeletonStat key={i} />)}
      {[0, 1, 2].map((i) => <SkeletonSmall key={i} />)}
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div className="panel space-y-0 overflow-hidden p-0" aria-busy="true" aria-label="Загрузка">
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
