// «Что нового»: the latest news item and planned maintenance (the events feed of all servers was removed from the main page).
import { useEffect, useState, type ReactNode } from 'react';
import { api, type PublicNews } from '../../api';
import { t, useI18n } from '../../i18n';
import { ago, fmtDateTime, fmtTime, usePoll } from '../../ui';
import { IconChevronDown } from '../../icons';
import { StateView } from '../StateView';
import type { OverviewData, RecentEvent } from './overviewLogic';

const OPEN_KEY = 'coregsm_whatsnew_open';

export function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}
const saveOpen = (v: boolean) => {
  try {
    localStorage.setItem(OPEN_KEY, v ? '1' : '0');
  } catch {
    /* not remembered */
  }
};

/** the link of a news item (the embed address), only http(s) */
export function newsLink(n: Pick<PublicNews, 'payload'>): string | null {
  const u = n.payload?.embed?.url;
  return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null;
}

/** a plain-text teaser: markdown marks removed */
export function excerptOf(n: Pick<PublicNews, 'payload'>, max = 150): string {
  const raw = n.payload?.embed?.description || n.payload?.content || '';
  const s = raw.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^\s*[-*•]\s+/gm, '• ').replace(/[*_~`|>#]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

/** a news teaser as nodes: markdown links, http(s) addresses and bare domains become real links (http/https only) */
export function teaserNodes(n: Pick<PublicNews, 'payload'>, max = 220): ReactNode[] {
  const raw = (n.payload?.embed?.description || n.payload?.content || '')
    .replace(/^\s*[-*•]\s+/gm, '• ')
    .replace(/[*_~`|>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)|\b((?:[a-z0-9-]+\.)+(?:ru|com|net|org|io|gg|tv|me|su|рф|app|dev|xyz)(?:\/[^\s)]*)?)/giu;
  const out: ReactNode[] = [];
  let used = 0;
  let last = 0;
  let key = 0;
  const push = (text: string): boolean => {
    if (!text) return true;
    const room = max - used;
    if (room <= 0) return false;
    if (text.length > room) {
      out.push(text.slice(0, room).trimEnd() + '…');
      used = max;
      return false;
    }
    out.push(text);
    used += text.length;
    return true;
  };
  for (const m of raw.matchAll(re)) {
    const at = m.index ?? 0;
    if (!push(raw.slice(last, at))) return out;
    const label = m[1] ?? m[3] ?? m[4] ?? '';
    const href = m[2] ?? (m[3] ? m[3] : m[4] ? `https://${m[4]}` : '');
    const shown = label.length > 38 ? `${label.slice(0, 37)}…` : label;
    if (used + shown.length > max) {
      push(shown);
      return out;
    }
    out.push(
      <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="srv-new-link" onClick={(e) => e.stopPropagation()}>
        {shown}
      </a>,
    );
    used += shown.length;
    last = at + m[0].length;
  }
  push(raw.slice(last));
  return out;
}

const DOT: Record<RecentEvent['type'], string> = { up: 'bg-ok', down: 'bg-bad', peak: 'bg-link', maintenance: 'bg-warn' };

function eventText(e: RecentEvent): string {
  const name = e.serverName ?? t('srv.new.allServers');
  switch (e.type) {
    case 'up': return t('srv.new.ev.up', { name });
    case 'down': return t('srv.new.ev.down', { name });
    case 'peak': return t('srv.new.ev.peak', { name, n: e.players ?? 0 });
    default: return t('srv.new.ev.maint', { name: e.serverName ? `${e.name || ''} · ${e.serverName}`.replace(/^ · /, '') : e.name || name });
  }
}

export function WhatsNew({ open, onToggle, overview }: { open: boolean; onToggle: () => void; overview: OverviewData | null }) {
  useI18n();
  const [news, setNews] = useState<PublicNews | null | undefined>(undefined);

  // nothing is fetched while the block is folded
  usePoll(() => {
    if (!open) return;
    return api<PublicNews[]>('/news')
      .then((l) => setNews(l.find((n) => n.status === 'sent' || n.status === 'edit_queued') ?? null))
      .catch(() => setNews(null));
  }, 60_000);

  const maint = overview?.maintenance ?? [];
  const bodyId = 'srv-whatsnew-body';
  return (
    <aside className="panel srv-new" aria-label={t('srv.new.title')}>
      <h2 className="m-0">
        <button type="button" className="srv-new-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span className="font-black">{t('srv.new.title')}</span>
          <span aria-hidden className={`srv-new-chev ${open ? 'open' : ''}`}><IconChevronDown /></span>
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="srv-new-body">
          <section>
            <h3 className="srv-new-h">{t('srv.new.news')}</h3>
            {news === undefined ? (
              <div className="skeleton h-16 rounded-2xl" aria-busy="true" />
            ) : news ? (
              <div className="srv-new-news">
                <a href="/news" className="srv-new-news-title">{news.title || t('srv.new.untitled')}</a>
                {teaserNodes(news).length > 0 && <span className="srv-new-news-text">{teaserNodes(news)}</span>}
                <span className="srv-new-news-foot">
                  {news.sentAt && <span className="srv-new-date">{fmtDateTime(news.sentAt)}</span>}
                  {newsLink(news) && (
                    <a href={newsLink(news)!} target="_blank" rel="noopener noreferrer" className="btn-link btn-xs">
                      {t('srv.new.openLink')}
                    </a>
                  )}
                  <a href="/news" className="btn-link btn-xs">{t('srv.new.allNews')}</a>
                </span>
              </div>
            ) : (
              <StateView bare compact title={t('srv.new.noNews')} text="" />
            )}
          </section>

          <section>
            <h3 className="srv-new-h">{t('srv.new.maint')}</h3>
            {maint.length === 0 ? (
              <StateView bare compact title={t('srv.new.noMaint')} text="" />
            ) : (
              <ul className="srv-new-list">
                {maint.map((m) => (
                  <li key={m.id}>
                    <span className={`srv-new-dot ${m.active ? 'bg-warn' : 'bg-mute'}`} aria-hidden />
                    <div className="min-w-0">
                      <div className="truncate font-extrabold">{m.name}{m.serverName ? ` · ${m.serverName}` : ''}</div>
                      <div className="text-[13px] font-bold text-mute">
                        {m.active ? t('srv.new.until', { time: fmtDateTime(m.endTs) }) : t('srv.new.from', { from: fmtDateTime(m.startTs), to: fmtTime(m.endTs) })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

        </div>
      )}
    </aside>
  );
}

/** the folded state is remembered; kept here so the page does not touch localStorage itself */
export function useWhatsNewOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(readOpen);
  useEffect(() => saveOpen(open), [open]);
  return [open, () => setOpen((v) => !v)];
}
