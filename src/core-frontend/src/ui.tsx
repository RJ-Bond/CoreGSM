import { useEffect, useRef, type ReactNode } from 'react';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="max-h-full w-full max-w-lg overflow-auto rounded-md border border-line bg-panel p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-blurple-soft">{title}</h2>
          <button className="text-mute hover:text-fg" onClick={onClose} aria-label="Закрыть">✕</button>
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

export function Status({ online, known }: { online: boolean; known: boolean }) {
  if (!known) return <span className="text-mute">● WAIT</span>;
  return online ? <span className="text-ok">● UP</span> : <span className="text-bad">● DOWN</span>;
}

export function Bar({ value, max, warn }: { value: number; max: number; warn?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span className="mr-2 inline-block h-1.5 w-16 overflow-hidden rounded bg-ink align-middle">
      <span className={`block h-full ${warn ? 'bg-warn' : 'bg-blurple'}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-lg font-semibold text-fg">
        <span className="text-blurple-soft">~/</span>
        {title}
      </h1>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export function ErrorLine({ text }: { text: string }) {
  return text ? <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-bad">{text}</p> : null;
}

export const ago = (ts: number | null) => {
  if (!ts) return '–';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s} с назад`;
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  return `${Math.floor(s / 3600)} ч назад`;
};
