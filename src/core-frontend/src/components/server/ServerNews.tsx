import { useEffect, useState } from 'react';
import { api, type PublicNews } from '../../api';
import { t, useI18n } from '../../i18n';
import { ago } from '../../ui';

const FRESH_MS = 14 * 86_400_000;

/** a line on the page of a server: the news that names this server, if there is a fresh one («Объявление сервера») */
export default function ServerNews({ serverId }: { serverId: number }) {
  useI18n();
  const [item, setItem] = useState<PublicNews | null>(null);
  useEffect(() => {
    let off = false;
    setItem(null);
    api<PublicNews[]>(`/news?server=${serverId}&limit=1`)
      .then((l) => { if (!off) setItem(Array.isArray(l) && l[0] ? l[0] : null); })
      .catch(() => undefined);
    return () => { off = true; };
  }, [serverId]);
  if (!item || !item.sentAt || Date.now() - item.sentAt > FRESH_MS) return null;
  const title = item.payload?.embed?.title || item.title || t('nw.untitled');
  return (
    <a className="sv-news" href={`/news/${item.id}`}>
      <span className="sv-news-k">{t('sd.news')}</span>
      <b className="sv-news-t">{title}</b>
      <span className="sv-news-w">{ago(item.sentAt)} →</span>
    </a>
  );
}
