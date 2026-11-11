/**
 * The speed the visitors really see: the numbers of the load of a page (LCP, INP, CLS, TTFB, FCP) are sent once, when the page
 * is hidden or closed, to POST /api/rum (see monitoring/rum.ts on the backend). Nothing about the person goes with them: only the
 * name of the page where the visit began and the numbers. Not sent when the browser says «do not track».
 */
type Metric = 'LCP' | 'INP' | 'CLS' | 'TTFB' | 'FCP';

/** the page of the panel a path belongs to (the same short list as on the backend) */
export function rumRoute(path: string): string {
  const [first = '', second = ''] = path.replace(/^\/+/, '').split('/');
  if (first === '' || first === 'servers') return second && /^\d+$/.test(second) ? 'server' : 'servers';
  if (['news', 'status', 'community', 'bans', 'profile', 'login', 'register', 'admin'].includes(first)) return first;
  if (first === 'player' || first === 'u') return 'player';
  return 'other';
}

/** a layout shift counts in windows (as web.dev does): a window ends after 1 s of quiet or 5 s in all; the worst window is the number */
export function worstShiftWindow(shifts: { at: number; value: number }[]): number {
  let worst = 0;
  let sum = 0;
  let start = 0;
  let last = 0;
  for (const s of shifts) {
    if (sum === 0 || s.at - last > 1000 || s.at - start > 5000) {
      sum = 0;
      start = s.at;
    }
    sum += s.value;
    last = s.at;
    worst = Math.max(worst, sum);
  }
  return worst;
}

export function initRum(): void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
  if (navigator.doNotTrack === '1') return;
  const landing = rumRoute(window.location.pathname);
  const m: Partial<Record<Metric, number>> = {};
  const shifts: { at: number; value: number }[] = [];
  let slowest = 0;
  let sent = false;

  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav && nav.responseStart > 0) m.TTFB = nav.responseStart;

  const observe = (type: string, fn: (entries: PerformanceEntry[]) => void, extra: Record<string, unknown> = {}) => {
    try {
      const po = new PerformanceObserver((list) => fn(list.getEntries()));
      po.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    } catch {
      /* the browser does not know this kind of entry */
    }
  };
  observe('paint', (es) => { for (const e of es) if (e.name === 'first-contentful-paint') m.FCP = e.startTime; });
  observe('largest-contentful-paint', (es) => { const e = es[es.length - 1]; if (e) m.LCP = e.startTime; });
  observe('layout-shift', (es) => {
    for (const e of es as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) shifts.push({ at: e.startTime, value: e.value });
    m.CLS = worstShiftWindow(shifts);
  });
  observe('event', (es) => {
    for (const e of es as (PerformanceEntry & { interactionId?: number })[]) if ((e.interactionId ?? 0) > 0) slowest = Math.max(slowest, e.duration);
    if (slowest > 0) m.INP = slowest;
  }, { durationThreshold: 40 });

  const send = () => {
    if (sent) return;
    const body: Partial<Record<Metric, number>> = {};
    for (const [k, v] of Object.entries(m) as [Metric, number][]) if (Number.isFinite(v) && v >= 0) body[k] = k === 'CLS' ? Math.round(v * 1000) / 1000 : Math.round(v);
    if (Object.keys(body).length === 0) return;
    sent = true;
    try {
      navigator.sendBeacon('/api/rum', new Blob([JSON.stringify({ route: landing, m: body })], { type: 'application/json' }));
    } catch {
      /* a beacon that cannot be sent is not worth anything */
    }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(); });
  window.addEventListener('pagehide', send);
}
