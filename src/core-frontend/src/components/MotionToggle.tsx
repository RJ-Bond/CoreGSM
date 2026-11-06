import { useAppearance } from '../appearance';
import { t, useI18n } from '../i18n';

/** one button for «less movement»: animations off (the same switch as in the profile), remembered in this browser */
export function MotionToggle() {
  useI18n();
  const [look, setLook] = useAppearance();
  const off = look.reduceMotion;
  const label = off ? t('hdr.motionOn') : t('hdr.motionOff');
  return (
    <button type="button" className="btn-icon hdr-motion" aria-pressed={off} title={label} aria-label={label} onClick={() => setLook({ reduceMotion: !off })}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {/* sparkles: «animations»; crossed out when they are off */}
        <path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z" />
        <path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z" />
        {off && <path d="M3 3l18 18" />}
      </svg>
    </button>
  );
}
