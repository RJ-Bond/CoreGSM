import type { CSSProperties } from 'react';
import { ACCENT_MODES, useAccentMode } from '../accent';
import { gameColor } from '../games';

const swatch: Record<string, string | undefined> = { vrising: gameColor('vrising'), icarus: gameColor('icarus') };

/** «Акцент по игре»: a segmented choice kept in this browser only (see accent.ts) */
export function AccentPicker() {
  const [mode, setMode] = useAccentMode();
  return (
    <div>
      <span id="accent-label" className="label">Акцент по игре</span>
      <div className="seg flex-wrap" role="group" aria-labelledby="accent-label">
        {ACCENT_MODES.map((o) => (
          <button key={o.id} type="button" className="seg-item" aria-pressed={mode === o.id} onClick={() => setMode(o.id)}>
            {swatch[o.id] && <span className="accent-dot" style={{ '--sw': swatch[o.id] } as CSSProperties} aria-hidden />}
            {o.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm font-semibold text-mute">{ACCENT_MODES.find((o) => o.id === mode)?.hint}. Запоминается в этом браузере.</p>
    </div>
  );
}
