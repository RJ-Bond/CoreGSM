/**
 * A short tap of the vibration motor on a phone: a confirmation, a switch, a favourite. Only where the device has a
 * motor and a touch screen, and never with «reduce motion» (the setting of the panel or of the system).
 */
const PATTERNS = { tap: 8, ok: [10, 40, 14], warn: [24, 50, 24] } as const;
export function haptic(kind: keyof typeof PATTERNS = 'tap'): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (document.documentElement.dataset.motion === 'reduce') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;
    navigator.vibrate(PATTERNS[kind] as number | number[]);
  } catch {
    /* a device without the motor: nothing to do */
  }
}
