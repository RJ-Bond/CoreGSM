import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { t, useI18n } from '../i18n';

/** time as a person says it: «сегодня 16:02», «завтра 04:00», «через 15 мин», «5 мин назад» (no seconds, no year) */
export function soon(ts: number | null, now = Date.now()): string {
  if (!ts) return '—';
  const diff = ts - now;
  const abs = Math.abs(diff);
  const clock = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const amount = (ms: number) => {
    const min = Math.max(1, Math.round(ms / 60_000));
    return min < 90 ? t('gn.rt.min', { n: min }) : t('gn.rt.h', { n: Math.round(min / 60) });
  };
  if (abs < 6 * 3_600_000) return diff >= 0 ? t('gn.rt.in', { t: amount(abs) }) : t('gn.rt.ago', { t: amount(abs) });
  const d = new Date(ts);
  const n = new Date(now);
  const day = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const gap = Math.round((day(d) - day(n)) / 86_400_000);
  if (gap === 0) return t('gn.rt.today', { time: clock });
  if (gap === 1) return t('gn.rt.tomorrow', { time: clock });
  if (gap === -1) return t('gn.rt.yesterday', { time: clock });
  return `${d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} ${clock}`;
}

/** a text area that grows with its text, so nothing is cut off */
export function AutoText({ value, className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof value !== 'string') return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} value={value} className={`input resize-none overflow-hidden ${className}`.trim()} {...rest} />;
}

const KEY = (id: string) => `coregsm.gn.fold.${id}`;
const readOpen = (id: string, fallback: boolean): boolean => {
  try { const v = localStorage.getItem(KEY(id)); return v == null ? fallback : v === '1'; } catch { return fallback; }
};

/**
 * A settings card that folds: the header always shows what it is and whether it is on, the body opens on a click.
 * The state of every card is remembered in this browser. `status` is the «Сохранено» badge, shown next to the header.
 */
export function FoldCard({ id, title, summary, on, defaultOpen = false, status, children }: {
  id: string; title: string; summary?: ReactNode; on?: boolean; defaultOpen?: boolean; status?: ReactNode; children: ReactNode;
}) {
  useI18n();
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  const body = useId();
  useEffect(() => { try { localStorage.setItem(KEY(id), open ? '1' : '0'); } catch { /* private mode */ } }, [id, open]);

  return (
    <section id={`gn-card-${id}`} className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 basis-64 items-center gap-3 text-left"
          aria-expanded={open}
          aria-controls={body}
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden className={`inline-block text-mute transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
          <span className="min-w-0">
            <span className="block font-extrabold">{title}</span>
            {summary != null && <span className="block text-sm font-semibold text-mute">{summary}</span>}
          </span>
        </button>
        {on != null && <span className={on ? 'pill pill-ok' : 'pill pill-mute'}>{on ? t('gn.f.on') : t('gn.f.off')}</span>}
        {status}
      </div>
      {open && <div id={body} className="space-y-4 border-t border-line px-5 py-4">{children}</div>}
    </section>
  );
}

/** the variables of a text: a click puts one into the text, the example shows what it turns into */
export function VarChips({ vars, onPick }: { vars: { name: string; example: string }[]; onPick: (v: string) => void }) {
  useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-bold text-mute">{t('gn.vh.label')}</span>
      {vars.map((v) => (
        <button key={v.name} type="button" className="chip-filter font-mono" title={`${v.name} → ${v.example}`} onClick={() => onPick(`{${v.name}}`)}>
          {`{${v.name}}`}<span className="ml-1.5 font-sans font-semibold text-mute">→ {v.example}</span>
        </button>
      ))}
    </div>
  );
}
