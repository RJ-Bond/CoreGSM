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
        {off ? <><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></> : <><path d="M3 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0" /></>}
      </svg>
    </button>
  );
}
