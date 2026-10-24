import { useState, type ReactNode } from 'react';
import { Icon } from '../../icons';
import { t } from '../../i18n';
import { toast } from '../../ui';

export const IcoClock = () => <Icon size={18}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></Icon>;
export const IcoPlay = () => <Icon size={18}><path d="m5 3 14 9-14 9V3Z" /></Icon>;
export const IcoFlame = () => <Icon size={18}><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></Icon>;
export const IcoTimer = () => <Icon size={18}><path d="M10 2h4M12 14l3-3" /><circle cx="12" cy="14" r="8" /></Icon>;
export const IcoHeart = () => <Icon size={18}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" /></Icon>;
export const IcoCalendar = () => <Icon size={16}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Icon>;
export const IcoGamepad = () => <Icon size={16}><path d="M6 12h4M8 10v4M15 13h.01M18 11h.01" /><rect x="2" y="6" width="20" height="12" rx="5" /></Icon>;
export const IcoDiscord = () => <Icon size={16}><path d="M5 5a14 14 0 0 1 14 0c1.5 3.5 2 7 1.5 11-1.5 1-3 1.7-4.5 2l-1-2a9 9 0 0 1-9 0l-1 2c-1.5-.3-3-1-4.500-2C3 12 3.500 8.500 5 5Z" /><path d="M9 12h.01M15 12h.01" /></Icon>;
export const IcoLogout = () => <Icon size={18}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></Icon>;
export const IcoShare = () => <Icon size={18}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></Icon>;
export const IcoLock = () => <Icon size={12}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Icon>;
export const IcoCheck = () => <Icon size={12}><path d="M20 6 9 17l-5-5" /></Icon>;
export const IcoHome = () => <Icon size={16}><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /></Icon>;
export const IcoSliders = () => <Icon size={16}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></Icon>;
export const IcoShield = () => <Icon size={16}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /></Icon>;

/** a stat tile: icon, value and label; `hot` tints the icon (a streak of a week or more) */
export function StatTile({ value, label, icon, hot = false }: { value: string; label: string; icon?: ReactNode; hot?: boolean }) {
  return (
    <div className="pf-tile">
      {icon && <span className={`pf-tile-ico ${hot ? 'is-hot' : ''}`} aria-hidden>{icon}</span>}
      <div className="pf-tile-v">{value}</div>
      <div className="pf-tile-l">{label}</div>
    </div>
  );
}

/** copies the address of the public profile */
export function ShareButton({ username }: { username: string }) {
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    setBusy(true);
    try { await navigator.clipboard.writeText(`${window.location.origin}/u/${encodeURIComponent(username)}`); toast(t('pf.share.copied')); } catch { toast(t('nw.copyFail'), 'err'); }
    setBusy(false);
  };
  return (
    <button type="button" className="btn btn-soft btn-sm pf-icon-btn" onClick={() => void copy()} disabled={busy} title={t('pf.share')} aria-label={t('pf.share')}>
      <IcoShare /><span className="max-sm:sr-only">{t('pf.share')}</span>
    </button>
  );
}
