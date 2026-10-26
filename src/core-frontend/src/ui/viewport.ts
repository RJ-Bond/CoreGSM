/**
 * Phone viewport helpers.
 *  - `--kb`: the height of the on-screen keyboard (0 without it). Dialogs and the bottom bar lift by it, so a field is never hidden under the keys.
 *  - a focused field is scrolled into view once the keyboard has opened.
 * Called once before the first paint.
 */
export function installViewport(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let last = -1;
  const sync = () => {
    // innerHeight stays the size of the layout viewport; the visual one shrinks under the keyboard
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    const v = kb > 80 ? kb : 0;
    if (v === last) return;
    last = v;
    root.style.setProperty('--kb', v + 'px');
    root.classList.toggle('has-kb', v > 0);
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  sync();
  document.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement | null;
    if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !matchMedia('(pointer: coarse)').matches) return;
    // wait for the keyboard to slide in
    window.setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } catch { /* ignore */ } }, 320);
  });
}
