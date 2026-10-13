// «Что нового»: the latest news item, planned maintenance and the last events of all servers.
import { useEffect, useState } from 'react';
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

/** a plain-text teaser: markdown marks removed */
export function excerptOf(n: Pick<PublicNews, 'payload'>, max = 150): string {
  const raw = n.payload?.embed?.description || n.payload?.content || '';
  const s = raw.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^\s*[-*•]\s+/gm, '• ').replace(/[*_~`|>#]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
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
  const [events, setEvents] = useState<RecentEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  // nothing is fetched while the block is folded
  usePoll(() => {
    if (!open) return;
    return Promise.all([
      api<PublicNews[]>('/news')
        .then((l) => setNews(l.find((n) => n.status === 'sent' || n.status === 'edit_queued') ?? null))
        .catch(() => setNews(null)),
      api<RecentEvent[]>('/events/recent?limit=8')
        .then((l) => { setEvents(l); setFailed(false); })
        .catch(() => setFailed(true)),
    ]);
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
              <a href="#/news" className="srv-new-news">
                <span className="srv-new-news-title">{news.title || t('srv.new.untitled')}</span>
                {excerptOf(news) && <span className="srv-new-news-text">{excerptOf(news)}</span>}
                {news.sentAt && <span className="srv-new-date">{fmtDateTime(news.sentAt)}</span>}
              </a>
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

          <section>
            <h3 className="srv-new-h">{t('srv.new.events')}</h3>
            {events === null && !failed ? (
              <div className="skeleton h-24 rounded-2xl" aria-busy="true" />
            ) : failed && !events ? (
              <StateView bare compact kind="error" title={t('srv.new.evFail')} text="" />
            ) : !events || events.length === 0 ? (
              <StateView bare compact title={t('srv.new.noEvents')} text="" />
            ) : (
              <ul className="srv-new-list">
                {events.map((e, i) => (
                  <li key={`${e.type}-${e.serverId}-${e.ts}-${i}`}>
                    <span className={`srv-new-dot ${DOT[e.type]}`} aria-hidden />
                    <a className="srv-new-ev" href={e.serverId != null ? `#/servers/${e.serverId}/events` : '#/servers'}>
                      <span className="block truncate font-bold">{eventText(e)}</span>
                      <span className="text-[13px] font-bold text-mute" title={fmtDateTime(e.ts)}>{ago(e.ts)}</span>
                    </a>
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
