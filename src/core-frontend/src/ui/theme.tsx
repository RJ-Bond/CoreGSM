/** Light / dark / auto theme. */
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { IconAuto, IconMoon, IconSun } from '../icons';
import { revealTransition } from '../useMotion';

// ---------- theme ----------
type Theme = 'auto' | 'light' | 'dark';
const THEME_KEY = 'coregsm_theme';
// the community's default, remembered so that the inline script of index.html can apply it before the first paint
const DEFAULT_KEY = 'coregsm_theme_default';
const valid = (t: string | null): t is Theme => t === 'auto' || t === 'light' || t === 'dark';
const read = (key: string): Theme | null => {
  try {
    const t = localStorage.getItem(key);
    return valid(t) ? t : null;
  } catch {
    return null;
  }
};
/** the visitor's own choice, else the community's default */
const readTheme = (): Theme => read(THEME_KEY) ?? read(DEFAULT_KEY) ?? 'dark';
const paint = (t: Theme) => {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
};
function applyTheme(t: Theme) {
  paint(t);
  try {
    // 'auto' is stored too: it is a choice, and the community default must not override it
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private mode: the theme just is not remembered */
  }
}
const subs = new Set<(t: Theme) => void>();

/** the administrator's default theme: applies to everyone who has not picked a theme in the header */
export function applyDefaultTheme(def: Theme) {
  try {
    localStorage.setItem(DEFAULT_KEY, def);
  } catch {
    /* not remembered: applied for this visit only */
  }
  if (read(THEME_KEY)) return;
  paint(def);
  subs.forEach((f) => f(def));
}

/** pick a theme from elsewhere (the Ctrl+K palette): the same as the header button, which follows */
export function setThemeChoice(t: Theme) {
  applyTheme(t);
  subs.forEach((f) => f(t));
}
export const currentTheme = (): Theme => readTheme();

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    subs.add(setTheme);
    return () => { subs.delete(setTheme); };
  }, []);
  const next: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' };
  const label: Record<Theme, string> = { auto: t('theme.auto'), light: t('theme.light'), dark: t('theme.dark') };
  return (
    <button
      type="button"
      className="btn-icon"
      title={t('theme.title', { name: label[theme] })}
      aria-label={t('theme.aria', { name: label[theme] })}
      onClick={(e) => {
        const t = next[theme];
        // the new theme grows as a circle out of the button (View Transitions); elsewhere it just switches
        const r = e.currentTarget.getBoundingClientRect();
        revealTransition(() => {
          applyTheme(t);
          setTheme(t);
        }, r.left + r.width / 2, r.top + r.height / 2);
      }}
    >
      {theme === 'light' ? <IconSun /> : theme === 'dark' ? <IconMoon /> : <IconAuto />}
    </button>
  );
}
