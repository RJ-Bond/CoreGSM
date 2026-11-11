/** A strip at the top while the device has no network: the data on screen is the last that arrived. It says so when the network is back. */
import { useEffect, useState } from 'react';
import { t } from '../i18n';

export function OfflineBar() {
  const [state, setState] = useState<'on' | 'off' | 'back'>(() => (typeof navigator !== 'undefined' && navigator.onLine === false ? 'off' : 'on'));
  useEffect(() => {
    let timer = 0;
    const off = () => { window.clearTimeout(timer); setState('off'); };
    const on = () => {
      setState((s) => (s === 'off' ? 'back' : s));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setState('on'), 2500);
    };
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => { window.clearTimeout(timer); window.removeEventListener('offline', off); window.removeEventListener('online', on); };
  }, []);
  const [testing, setTesting] = useState(false);
  const test = () => {
    setTesting(true);
    void fetch('/api/health', { cache: 'no-store' }).then((r) => { if (r.ok) { setState('back'); window.setTimeout(() => setState('on'), 2500); } }).catch(() => undefined).finally(() => setTesting(false));
  };
  if (state === 'on') return null;
  return (
    <div role="status" aria-live="polite" className={`net-bar ${state === 'back' ? 'is-back' : ''}`}>
      {state === 'off' ? t('net.offline') : t('net.back')}
      {state === 'off' && <button type="button" className="net-retry" onClick={test} disabled={testing}>{t('net.retry')}</button>}
    </div>
  );
}
