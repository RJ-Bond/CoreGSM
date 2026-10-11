import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { gameAbbr, gameColor } from './games';

export function usePoll(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ref.current();
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="pop panel max-h-full w-full max-w-lg overflow-auto p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-black">{title}</h2>
          <button className="grid h-8 w-8 place-items-center rounded-full bg-soft text-mute hover:text-ink" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function StatusPill({ online, known, lag }: { online: boolean; known: boolean; lag?: boolean }) {
  if (!known) return <span className="pill pill-mute">ОЖИДАНИЕ</span>;
  if (!online) return <span className="pill pill-bad">OFFLINE</span>;
  return lag ? <span className="pill pill-warn">LAG</span> : <span className="pill pill-ok">ONLINE</span>;
}

export function GameAvatar({ game, size = 44 }: { game: string; size?: number }) {
  return (
    <div
      className="grid shrink-0 place-items-center rounded-2xl font-black text-white"
      style={{ width: size, height: size, background: gameColor(game), fontSize: size * 0.34 }}
      aria-hidden
    >
      {gameAbbr(game)}
    </div>
  );
}

export function FillBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-3 overflow-hidden rounded-full bg-soft">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/** 24h player-count sparkline. Loads its own history; renders nothing until there are two points. */
export function Spark({ serverId, color }: { serverId: number; color: string }) {
  const [pts, setPts] = useState<number[]>([]);
  usePoll(() => {
    api<{ players: number }[]>(`/servers/${serverId}/history?hours=24`)
      .then((rows) => {
        // downsample to at most 48 points
        const step = Math.max(1, Math.ceil(rows.length / 48));
        setPts(rows.filter((_, i) => i % step === 0).map((r) => r.players));
      })
      .catch(() => undefined);
  }, 60_000);

  if (pts.length < 2) return <div className="h-9 rounded-xl bg-soft/60" aria-hidden />;
  const w = 240, h = 36;
  const max = Math.max(1, ...pts);
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * w, h - 3 - (v / max) * (h - 6)]);
  const d = 'M' + xy.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');
  const last = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none" role="img" aria-label="Игроки за 24 часа">
      <path d={`${d} L${w} ${h} L0 ${h}Z`} fill={color} opacity="0.14" />
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill={color} />
    </svg>
  );
}

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-3xl font-black tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 font-semibold text-mute">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function ErrorLine({ text }: { text: string }) {
  return text ? <p className="rounded-2xl bg-badbg px-4 py-2.5 font-bold text-bad" role="alert">{text}</p> : null;
}

export function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 grid h-14 w-14 place-items-center rounded-3xl bg-soft text-2xl text-brand">+</div>
      <h3 className="text-lg font-black">{title}</h3>
      <p className="max-w-sm font-semibold text-mute">{text}</p>
      {children}
    </div>
  );
}

export const ago = (ts: number | null) => {
  if (!ts) return '–';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s} с назад`;
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  return `${Math.floor(s / 3600)} ч назад`;
};
