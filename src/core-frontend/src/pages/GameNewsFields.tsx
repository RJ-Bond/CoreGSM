/** Small fields that several cards of the game plugin share. */
import { useState } from 'react';
import { t } from '../i18n';
import { SWATCHES, isHex } from '../gameNews';

export const onOff = (b: boolean) => (b ? t('gn.f.on') : t('gn.f.off'));

/** a colour: the palette, the system picker and a HEX box */
const RECENT_KEY = 'coregsm.gn.recentColors';
const readRecent = (): string[] => { try { return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]).filter(isHex).slice(0, 6); } catch { return []; } };
const SWATCH_HEX = new Set(SWATCHES.map((c) => c.hex));

export function ColorField({ label, value, onChange, gameHex }: { label: string; value: string; onChange: (v: string) => void; gameHex?: string }) {
  const [recent, setRecent] = useState<string[]>(readRecent);
  // a colour that was picked stays in the «recent» row of every colour field (kept in this browser)
  const remember = (v: string) => {
    if (!isHex(v) || SWATCH_HEX.has(v.toUpperCase())) return;
    const next = [v.toUpperCase(), ...readRecent().filter((x) => x.toUpperCase() !== v.toUpperCase())].slice(0, 6);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    setRecent(next);
  };
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-bold">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        {SWATCHES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`h-7 w-7 rounded-full border ${value.toUpperCase() === c.hex ? 'border-ink ring-2 ring-ink/40' : 'border-line'}`}
            style={{ background: c.hex }}
            aria-label={`${label}: ${c.hex}`}
            aria-pressed={value.toUpperCase() === c.hex}
            onClick={() => onChange(c.hex)}
          />
        ))}
        <input type="color" className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent p-0.5" value={isHex(value) ? value : '#FFFFFF'} aria-label={label} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <input className="input w-28 font-mono text-sm" value={value} maxLength={7} aria-label={`${label} HEX`} onChange={(e) => onChange(e.target.value)} onBlur={() => remember(value)} />
        {gameHex && value.toUpperCase() !== gameHex && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(gameHex)}>{t('gn.col.game')}</button>}
      </div>
      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-mute">{t('gn.col.recent')}</span>
          {recent.map((c) => (
            <button key={c} type="button" className={`h-6 w-6 rounded-full border ${value.toUpperCase() === c ? 'border-ink ring-2 ring-ink/40' : 'border-line'}`} style={{ background: c }} aria-label={`${label}: ${c}`} onClick={() => onChange(c)} />
          ))}
        </div>
      )}
    </div>
  );
}
