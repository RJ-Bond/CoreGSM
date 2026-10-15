/** Animated numbers and small CSS-only flourishes; all respect reduced motion. */
import { type CSSProperties, useEffect, useRef, useState } from 'react';

const reducedMotion = () => typeof window !== 'undefined' && (document.documentElement.dataset.motion === 'reduce' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** the number counts to its new value instead of jumping (about 600 ms; instant with reduced motion) */
export function useTween(value: number, ms = 600): number {
  const [shown, setShown] = useState(value);
  const cur = useRef(value);
  useEffect(() => {
    if (cur.current === value) return;
    if (reducedMotion()) { cur.current = value; setShown(value); return; }
    const from = cur.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      cur.current = k >= 1 ? value : Math.round(from + (value - from) * eased);
      setShown(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Tabular number whose digits roll vertically (slot-machine style) when the value changes.
 * `pulse`: the number glows briefly; `delta`: a «+3» / «−2» chip floats above it for about two seconds.
 * The real number is in a visually hidden node, the rolling digits are decoration (aria-hidden); no layout shift.
 */
export function AnimatedNumber({ value, className = '', pulse = false, delta = false }: { value: number; className?: string; pulse?: boolean; delta?: boolean }) {
  const [bump, setBump] = useState(false);
  const [chip, setChip] = useState<{ n: number; k: number } | null>(null);
  const prev = useRef(value);
  const born = useRef(true);
  useEffect(() => {
    const diff = value - prev.current;
    prev.current = value;
    if (born.current) { born.current = false; return; }
    if (diff === 0) return;
    const timers: number[] = [];
    if (pulse) {
      setBump(true);
      timers.push(window.setTimeout(() => setBump(false), 950));
    }
    if (delta) {
      setChip({ n: diff, k: Date.now() });
      timers.push(window.setTimeout(() => setChip(null), 2100));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [value, pulse, delta]);

  const text = String(Math.round(value));
  const chars = [...text];
  return (
    <span className={`roll ${bump ? 'num-bump' : ''} ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {chars.map((c, i) => {
          // keyed from the right, so a column keeps its identity when the number grows by a digit
          const key = chars.length - i;
          return /\d/.test(c)
            ? (
              <span key={key} className="roll-d">
                <span className="roll-g">0</span>
                <span className="roll-col" style={{ transform: `translateY(${-Number(c)}em)` }}>
                  {DIGITS.map((d) => <span key={d}>{d}</span>)}
                </span>
              </span>
            )
            : <span key={key}>{c}</span>;
        })}
      </span>
      {chip && <span key={chip.k} aria-hidden className={`delta-chip ${chip.n > 0 ? 'up' : 'down'}`}>{chip.n > 0 ? `+${chip.n}` : `−${Math.abs(chip.n)}`}</span>}
    </span>
  );
}

/** a few dots flying out of the centre of the parent (the parent must be `relative`); CSS only */
export function Burst({ count = 8, radius = 17 }: { count?: number; radius?: number }) {
  return (
    <span className="burst" aria-hidden style={{ '--r': `${radius}px` } as CSSProperties}>
      {Array.from({ length: count }, (_, i) => <i key={i} style={{ '--a': `${Math.round((360 / count) * i + 15)}deg` } as CSSProperties} />)}
    </span>
  );
}
