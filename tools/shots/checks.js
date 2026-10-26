/* Runs INSIDE the page (sent through Runtime.evaluate as text). Returns what is visibly wrong with the current screen.
   Written as one expression so that it has no imports and no build step. */
(() => {
  const BAD = /(?:^|[^\p{L}\p{N}_])(undefined|NaN|\[object Object\]|null|Invalid Date)(?![\p{L}\p{N}_])/u;
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const phone = vw < 600;
  const name = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    const txt = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    return `${el.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ''}${txt ? ` "${txt}"` : ''}`;
  };
  const shown = (el, cs, r) => r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
    }
    return false;
  };

  const out = { scrollW: doc.scrollWidth, vw, height: doc.scrollHeight, title: document.title, h1: (document.querySelector('h1')?.innerText || '').trim().slice(0, 60) };
  const wide = [], clipped = [], tiny = [], noName = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!shown(el, cs, r) || cs.position === 'fixed') continue;
    // inside a closed <details> the browser hides the content (it still has a box, but no text)
    const det = el.closest('details:not([open])');
    if (det && !el.closest('summary')) continue;
    if (r.right > vw + 1 && !inScroller(el)) wide.push(`${name(el)} right=${Math.round(r.right)}`);
    // text cut off by its box with no ellipsis: it just disappears
    if (r.width > 4 && (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && el.children.length === 0 && (el.textContent || '').trim()) {
      clipped.push(`${name(el)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    if (phone && el.matches('button, [role=tab], select, input:not([type=hidden]):not([type=checkbox]):not([type=radio])') && (r.width < 28 || r.height < 28)) tiny.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (el.matches('button, a[href]') && !(el.innerText || '').trim() && !el.getAttribute('aria-label') && !el.getAttribute('title') && !el.querySelector('img[alt]:not([alt=""])')) noName.push(`${name(el)} ${el.outerHTML.slice(0, 110).replace(/s+/g, ' ')}`);
  }
  // the sliding pill under the current tab must sit exactly on it (it drifted when a link sat in a positioned wrapper)
  const pill = document.querySelector('.adm-ind');
  const cur = document.querySelector('.adm-nav .adm-link[aria-current="page"]');
  out.pillOff = '';
  if (pill && cur) {
    const p = pill.getBoundingClientRect(), c = cur.getBoundingClientRect();
    if (Math.abs(p.left - c.left) > 3 || Math.abs(p.top - c.top) > 3 || Math.abs(p.width - c.width) > 3) out.pillOff = `pill at ${Math.round(p.left)},${Math.round(p.top)} ${Math.round(p.width)}px, current tab at ${Math.round(c.left)},${Math.round(c.top)} ${Math.round(c.width)}px`;
  }
  out.wide = wide.slice(0, 8);
  out.clipped = clipped.slice(0, 8);
  out.tiny = tiny.slice(0, 6);
  out.noName = noName.slice(0, 6);
  out.brokenImg = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc).map((i) => i.currentSrc.slice(-60)).slice(0, 5);
  const text = (document.querySelector('main') || document.body).innerText || '';
  const m = BAD.exec(text);
  out.badText = m ? text.slice(Math.max(0, m.index - 25), m.index + 40).replace(/\s+/g, ' ') : '';
  out.mainEmpty = text.trim().length < 20;
  out.busy = document.querySelectorAll('[aria-busy=true], .skeleton, .spin').length;
  return out;
})()
