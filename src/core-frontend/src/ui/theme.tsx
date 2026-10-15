/** Light / dark / auto theme. */
import { useState } from 'react';
import { t } from '../i18n';
import { IconAuto, IconMoon, IconSun } from '../icons';
import { revealTransition } from '../useMotion';

// ---------- theme ----------
type Theme = 'auto' | 'light' | 'dark';
const THEME_KEY = 'coregsm_theme';
const readTheme = (): Theme => {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
};
function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  try {
    if (t === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private mode: the theme just is not remembered */
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
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
