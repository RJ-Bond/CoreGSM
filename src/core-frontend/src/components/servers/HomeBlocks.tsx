import { useEffect, useRef, useState } from 'react';
import { t, useI18n } from '../../i18n';
import { HERO_MODES, type HeroMode } from './heroLogic';

/** which blocks of the servers page are shown: remembered in this browser; both are on until the person turns one off */
export interface HomeBlocks { pulse: boolean; news: boolean }
const KEY = 'coregsm_home_blocks';
const ALL_ON: HomeBlocks = { pulse: true, news: true };

const read = (): HomeBlocks => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<HomeBlocks>;
    return { pulse: v.pulse !== false, news: v.news !== false };
  } catch {
    return ALL_ON;
  }
};

export function useHomeBlocks(): [HomeBlocks, (patch: Partial<HomeBlocks>) => void] {
  const [blocks, setBlocks] = useState<HomeBlocks>(read);
  const set = (patch: Partial<HomeBlocks>) => setBlocks((b) => {
    const next = { ...b, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not remembered */ }
    return next;
  });
  return [blocks, set];
}

/** «Customise»: a small menu with a switch for every block of the page; closes on Esc and on a click outside */
export function HomeBlocksMenu({ blocks, onChange, heroMode, onHeroMode }: { blocks: HomeBlocks; onChange: (patch: Partial<HomeBlocks>) => void; heroMode?: HeroMode; onHeroMode?: (m: HeroMode) => void }) {
  useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const rows: [keyof HomeBlocks, string][] = [['pulse', t('home.b.pulse')], ['news', t('home.b.news')]];
  return (
    <div className="home-blocks" ref={box}>
      <button type="button" className="btn btn-soft btn-sm" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{t('home.customize')}</button>
      {open && (
        <div className="home-blocks-pop" role="group" aria-label={t('home.customize')}>
          {rows.map(([k, label]) => (
            <label key={k} className="home-blocks-row">
              <input type="checkbox" className="srv-check" checked={blocks[k]} onChange={(e) => onChange({ [k]: e.target.checked })} />
              <span>{label}</span>
            </label>
          ))}
          {heroMode && onHeroMode && (
            <div className="home-blocks-hero" role="radiogroup" aria-label={t('home.hero')}>
              <p className="home-blocks-h">{t('home.hero')}</p>
              {HERO_MODES.map((m) => (
                <label key={m} className="home-blocks-row">
                  <input type="radio" name="hero-mode" className="srv-check" checked={heroMode === m} onChange={() => onHeroMode(m)} />
                  <span>{t(`home.hero.${m}` as const)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
