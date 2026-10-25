// one icon set (24 px grid, 2 px stroke, currentColor): see icons.tsx; every icon is re-exported from here
export * from './icons';

// shared building blocks live in their own files; pages import everything from here
export { Button } from './components/Button';
export type { ButtonProps } from './components/Button';
export { Switch } from './components/Switch';
export { SplitButton } from './components/SplitButton';
export { StateView, LoadError, errorKind } from './components/StateView';
export type { StateKind } from './components/StateView';
export type { SplitItem } from './components/SplitButton';
export { useFlashOnChange, useDepth, useDensity, setDensity, prefersReducedMotion } from './useMotion';
export type { Density } from './useMotion';
export { useAutosave } from './autosave';
export type { SaveStatus, AutosaveOptions } from './autosave';

// everything else lives in src/ui/; the pages keep importing from here
export { usePoll, LAG_PING, isLag } from './ui/poll';
export { useTween, AnimatedNumber, Burst } from './ui/motion';
export { currentPath, navigate, parseRoute, routeQuery, useRoute } from './ui/route';
export type { Route } from './ui/route';
export { ago, fmtDate, fmtTime, fmtDateTime, fmtDay, num, plural } from './ui/format';
export { ThemeToggle, applyDefaultTheme, currentTheme, setThemeChoice } from './ui/theme';
export { Modal, Field, StatusPill, GameAvatar, FillBar, PageHead, GoLink, Notice, ErrorLine, Empty, CopyButton, Logo, ProxyField, InviteButton, SkeletonRows, Wordmark } from './ui/blocks';
export type { ProxyType } from './ui/blocks';
export { Spark, MiniSpark, smoothPath, smoothValues, SmoothArea, FleetBar, useSparkSpanMin, useHourTrend, spanCaption } from './ui/charts';
export { toast, dismissToast, undoable, Toaster } from './ui/toast';
export type { ToastAction, ToastOptions } from './ui/toast';
export { AuthShell, AuthBrand, AuthCard, useShake, Spinner, FieldError, PasswordField, passwordScore, PasswordStrength, UserAvatar, DiscordButton, DiscordBadge, OrDivider } from './ui/authParts';
export { AdminPage, Section, Strip, SaveBadge, TextField } from './ui/admin';
export { noAutofill } from './ui/noAutofill';
