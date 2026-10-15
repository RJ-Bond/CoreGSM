/**
 * Diagnostics for the "black square" report: open the panel as  https://host/?flashdebug=1  and switch to another
 * browser tab (or press PrintScreen) and back. For ~1.5 s after the page becomes visible, the page is scanned for
 * dark opaque boxes, canvases, videos and iframes; they get a red outline and are listed in a corner panel.
 * An empty list means the square is not a DOM element (GPU / compositor), see the note in the panel.
 */
const dark = (c: string) => {
  const m = c.match(/rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\)/);
  if (!m) return false;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  return a > 0.5 && Number(m[1]) + Number(m[2]) + Number(m[3]) < 90;
};

export function installFlashDebug() {
  let panel: HTMLDivElement | null = null;
  const ensure = () => {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.setAttribute('style', 'position:fixed;right:8px;bottom:8px;z-index:2147483647;max-width:min(420px,92vw);max-height:40vh;overflow:auto;background:#fff;color:#000;border:2px solid #e11;border-radius:8px;padding:8px;font:12px/1.35 monospace;white-space:pre-wrap');
    document.body.appendChild(panel);
    return panel;
  };
  const scan = (why: string) => {
    const found: string[] = [];
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      if (panel?.contains(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.3) return;
      const tag = el.tagName;
      const media = tag === 'CANVAS' || tag === 'VIDEO' || tag === 'IFRAME';
      if (media || dark(cs.backgroundColor)) {
        el.style.outline = '2px solid red';
        const cls = typeof el.className === 'string' ? el.className.slice(0, 60) : '';
        found.push(`${tag.toLowerCase()}${cls ? '.' + cls.trim().replace(/\s+/g, '.') : ''} ${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.left)},${Math.round(r.top)} bg=${cs.backgroundColor}`);
      }
    });
    const p = ensure();
    p.textContent = `[${new Date().toLocaleTimeString()}] ${why}\n` + (found.length ? found.slice(0, 25).join('\n') : 'тёмных DOM-элементов нет: квадрат рисует не страница, а GPU/композитор браузера (проверьте chrome://settings/system → «Использовать аппаратное ускорение» выкл.)');
  };
  const onShow = (why: string) => {
    [0, 120, 400, 900, 1500].forEach((t) => window.setTimeout(() => scan(`${why} +${t}мс`), t));
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onShow('вкладка видна'); });
  window.addEventListener('focus', () => onShow('окно в фокусе'));
  window.addEventListener('keyup', (e) => { if (e.key === 'PrintScreen') onShow('PrintScreen'); });
}
