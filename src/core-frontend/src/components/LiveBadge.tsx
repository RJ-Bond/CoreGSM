import { useEffect, useState } from 'react';
import { t, useI18n } from '../i18n';
import { ago } from '../ui';

/** the «live» indicator in the head of a page: a pulsing dot and how fresh the data is; a click asks for fresh data when the page can */
export default function LiveBadge({ at, onRefresh, busy = false }: { at: number; onRefresh?: () => void; busy?: boolean }) {
  useI18n();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 5000);
    return () => window.clearInterval(id);
  }, []);
  if (!at) return null;
  const text = busy ? t('d2.srv.refreshing') : t('d2.srv.updated', { ago: ago(at) });
  if (!onRefresh) return <span className="srv-live" aria-live="off"><span className="live-dot" aria-hidden />{text}</span>;
  return (
    <button type="button" className="srv-live" title={t('d2.srv.liveTitle')} onClick={onRefresh} aria-busy={busy || undefined}>
      <span className="live-dot" aria-hidden />
      {text}
    </button>
  );
}
