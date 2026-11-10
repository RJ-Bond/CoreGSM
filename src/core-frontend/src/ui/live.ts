import { useEffect, useRef, useState } from 'react';

/**
 * Live updates: one long GET /api/live (Server-Sent Events). The panel is told that a server was polled and runs `onSignal`
 * (a reload of its list) at once. Only while the tab is visible, not in the data-saving mode, and the connection closes
 * itself when the browser or the server refuses it; the caller then keeps its ordinary timer. Returns «connected».
 */
export function useLive(onSignal: () => unknown): boolean {
  const ref = useRef(onSignal);
  ref.current = onSignal;
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;
    let es: EventSource | null = null;
    let last = 0;
    let alive = true;
    const open = () => {
      if (!alive || es || document.hidden || document.documentElement.hasAttribute('data-lite')) return;
      es = new EventSource('/api/live');
      es.onopen = () => setLive(true);
      es.addEventListener('status', () => {
        // a burst of polls is one reload
        if (Date.now() - last < 800) return;
        last = Date.now();
        void ref.current();
      });
      es.onerror = () => {
        // the browser reconnects by itself after a break; a refusal (4xx, a closed panel) ends it for good
        setLive(false);
        if (es && es.readyState === EventSource.CLOSED) { es.close(); es = null; }
      };
    };
    const close = () => { es?.close(); es = null; setLive(false); };
    const onVisible = () => { if (document.hidden) close(); else open(); };
    document.addEventListener('visibilitychange', onVisible);
    open();
    return () => { alive = false; document.removeEventListener('visibilitychange', onVisible); close(); };
  }, []);
  return live;
}
