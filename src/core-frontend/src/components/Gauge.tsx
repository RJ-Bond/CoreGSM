import type { ReactNode } from 'react';

export type GaugeTone = 'ok' | 'warn' | 'bad' | 'mute';

/** tone by how full a resource is: < 75 % ok, 75..90 % warn, from 90 % bad */
export const usageTone = (fraction: number | null | undefined): GaugeTone =>
  fraction == null || !Number.isFinite(fraction) ? 'mute' : fraction >= 0.9 ? 'bad' : fraction >= 0.75 ? 'warn' : 'ok';

const R = 48;
const C = 2 * Math.PI * R;
const SWEEP = 0.75; // a 270 degree arc, the gap is at the bottom

/**
 * Ring gauge drawn as one static SVG arc (no animation). `value` is 0..1 (null: unknown, an empty track).
 * The colour is the status colour of the tone (never the only carrier of meaning: the number sits in the middle).
 */
export function Gauge({ value, tone, label, display, caption, icon }: {
  value: number | null; tone?: GaugeTone; label: string; display: ReactNode; caption?: ReactNode; icon?: ReactNode;
}) {
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  const t = tone ?? usageTone(value);
  return (
    <div className={`gauge-${t} mx-auto w-full max-w-38`} role="img" aria-label={`${label}: ${value == null ? 'нет данных' : `${Math.round(v * 100)} %`}`}>
      <div className="gauge">
      <svg viewBox="0 0 120 120" aria-hidden>
        <g transform="rotate(135 60 60)" fill="none" strokeWidth="11" strokeLinecap="round">
          <circle className="gauge-track" cx="60" cy="60" r={R} strokeDasharray={`${C * SWEEP} ${C}`} />
          {v > 0 && <circle className="gauge-arc" cx="60" cy="60" r={R} strokeDasharray={`${C * SWEEP * v} ${C}`} />}
        </g>
      </svg>
      <div className="gauge-value">
        {icon && <span className="mx-auto mb-0.5 text-mute">{icon}</span>}
        <span className="text-xl font-black leading-none tabular-nums">{display}</span>
      </div>
      </div>
      {caption && <div className="-mt-1 text-center text-xs font-bold text-mute">{caption}</div>}
    </div>
  );
}
