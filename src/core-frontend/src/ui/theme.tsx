/** Light / dark / auto theme. */
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { IconAuto, IconMoon, IconSun } from '../icons';
import { revealTransition } from '../useMotion';

// ---------- theme ----------
// 'night' is for the admin area only: dark in the evening and at night, light by day (by the clock of the device)
type Theme = 'auto' | 'light' | 'dark' | 'night';
export const NIGHT_FROM = 20;
export const NIGHT_TO = 7;
/** is it night by the schedule: from 20:00 to 07:00 */
export const isNightHour = (hour: number): boolean => hour >= NIGHT_FROM || hour < NIGHT_TO;
const THEME_KEY = 'coregsm_theme';
// the community's default, remembered so that the inline script of index.html can apply it before the first paint
const DEFAULT_KEY = 'coregsm_theme_default';
const valid = (t: string | null): t is Theme => t === 'auto' || t === 'light' || t === 'dark' || t === 'night';
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
// the admin area may have a theme of its own (e.g. a dark admin next to a light public site); without a choice it follows the site
const ADMIN_KEY = 'coregsm_admin_theme';
let adminScope = false;
/** the theme the visitor sees in the current area */
const readScoped = (): Theme => (adminScope ? read(ADMIN_KEY) ?? readTheme() : readTheme());
/** does the admin area have its own theme right now */
export const adminThemeIsOwn = (): boolean => read(ADMIN_KEY) !== null;
/** «243 244 248» (the page colour token) -> «#f3f4f8» */
export function rgbTokenToHex(token: string): string | null {
  const m = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*$/.exec(token);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return `#${parts.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The browser bar of a phone (and the title bar of an installed panel) takes the colour of the page of the current
 * theme. While a game accent paints the page, accent.ts owns the colour and this leaves it alone.
 */
function syncBarColor() {
  const root = document.documentElement;
  if (root.hasAttribute('data-game-art')) return;
  const hex = rgbTokenToHex(getComputedStyle(root).getPropertyValue('--page'));
  if (hex) document.querySelector('meta[name=theme-color]')?.setAttribute('content', hex);
}
let nightTimer = 0;
const paint = (t: Theme) => {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t === 'night' ? (isNightHour(new Date().getHours()) ? 'dark' : 'light') : t);
  syncBarColor();
  // the schedule is looked at again every minute while it is the theme in use
  window.clearInterval(nightTimer);
  if (t === 'night') nightTimer = window.setInterval(() => { if (readScoped() === 'night') paint('night'); }, 60_000);
};
function applyTheme(t: Theme) {
  paint(t);
  try {
    // 'auto' is stored too: it is a choice, and the community default must not override it
    localStorage.setItem(adminScope ? ADMIN_KEY : THEME_KEY, t);
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
  if (read(THEME_KEY) || (adminScope && read(ADMIN_KEY))) return;
  paint(def);
  subs.forEach((f) => f(def));
}

/** pick a theme from elsewhere (the Ctrl+K palette): the same as the header button, which follows */
export function setThemeChoice(t: Theme) {
  applyTheme(t);
  subs.forEach((f) => f(t));
}
export const currentTheme = (): Theme => readScoped();

/** the admin area was entered / left: paint its own theme (or the site's) and tell the buttons */
export function setThemeScope(admin: boolean) {
  if (adminScope === admin) return;
  adminScope = admin;
  const t = readScoped();
  paint(t);
  subs.forEach((f) => f(t));
}

/** «as on the site» for the admin area: forget its own theme */
export function resetAdminTheme() {
  try {
    localStorage.removeItem(ADMIN_KEY);
  } catch {
    /* nothing to forget */
  }
  const t = readScoped();
  paint(t);
  subs.forEach((f) => f(t));
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readScoped);
  useEffect(() => {
    subs.add(setTheme);
    return () => { subs.delete(setTheme); };
  }, []);
  // the schedule is a fourth step in the admin area only
  const next: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: adminScope ? 'night' : 'auto', night: 'auto' };
  const label: Record<Theme, string> = { auto: t('theme.auto'), light: t('theme.light'), dark: t('theme.dark'), night: t('theme.night') };
  return (
    <button
      type="button"
      className="btn-icon"
      title={adminScope ? t('theme.titleAdmin', { name: label[theme] }) : t('theme.title', { name: label[theme] })}
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
      {theme === 'light' ? <IconSun /> : theme === 'dark' || theme === 'night' ? <IconMoon /> : <IconAuto />}
    </button>
  );
}
