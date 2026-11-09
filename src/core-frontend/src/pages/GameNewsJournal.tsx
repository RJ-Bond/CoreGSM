import { useState } from 'react';
import { api } from '../api';
import { soon } from '../components/GameNewsParts';
import { Styled } from '../components/NewsEditor';
import { t, useI18n } from '../i18n';
import { usePoll } from '../ui';
import { EmptyState, SubTabs } from './GameNewsUi';

type Kind = 'message' | 'auto' | 'discord' | 'restart' | 'link' | 'mod';
interface Entry { id: string; ts: number; kind: Kind; serverId: number | null; serverName: string; text: string; status: string; error: string; by: string }

const FILTERS = ['all', 'message', 'auto', 'discord', 'restart', 'link', 'mod'] as const;
type Filter = (typeof FILTERS)[number];

const KIND_ICON: Record<Kind, string> = { message: '✉', auto: '⟳', discord: '💬', restart: '♻', link: '🔗', mod: '🚪' };

const MSG_STATUS: Record<string, { text: 'gn.h.queued' | 'gn.h.ok' | 'gn.h.expired' | 'gn.h.fail'; cls: string }> = {
  queued: { text: 'gn.h.queued', cls: 'pill pill-mute' },
  delivered: { text: 'gn.h.ok', cls: 'pill pill-ok' },
  expired: { text: 'gn.h.expired', cls: 'pill pill-warn' },
  failed: { text: 'gn.h.fail', cls: 'pill pill-warn' },
};
const RESTART_STATUS: Record<string, { text: 'gn.rr.o.counting' | 'gn.rr.o.done' | 'gn.rr.o.cancelled' | 'gn.rr.o.missed' | 'gn.rr.o.replaced'; cls: string }> = {
  counting: { text: 'gn.rr.o.counting', cls: 'pill pill-warn' },
  done: { text: 'gn.rr.o.done', cls: 'pill pill-ok' },
  cancelled: { text: 'gn.rr.o.cancelled', cls: 'pill pill-mute' },
  missed: { text: 'gn.rr.o.missed', cls: 'pill pill-warn' },
  replaced: { text: 'gn.rr.o.replaced', cls: 'pill pill-mute' },
};
const LINK_TEXT: Record<string, 'gn.jn.reg' | 'gn.jn.login' | 'gn.jn.unlink'> = { game_register: 'gn.jn.reg', game_login: 'gn.jn.login', game_unlink: 'gn.jn.unlink' };

/** everything the plugin did in one list: messages (by hand, by a rule, from Discord), restarts, linked players */
export function JournalTab({ onReuse, onPlayer }: { onReuse: (text: string) => void; onPlayer: (nick: string) => void }) {
  useI18n();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<Entry[] | null>(null);
  usePoll(() => api<{ items: Entry[] }>(`/game-news/journal?kind=${filter}`).then((d) => setItems(d.items)).catch(() => undefined), 10_000);
  // the first read of a new filter shows the old list for a moment: it is replaced at once
  const pick = (f: Filter) => { setFilter(f); setItems(null); };

  return (
    <section className="panel space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-extrabold">{t('gn.jn.title')}</h3>
      </div>
      <SubTabs label={t('gn.jn.title')} value={filter} onChange={pick} items={FILTERS.map((f) => ({ id: f, label: t(`gn.jn.f.${f}` as 'gn.jn.f.all') }))} />
      {items == null && <div className="skeleton h-24 rounded-xl" aria-busy="true" />}
      {items && items.length === 0 && <EmptyState icon="🗒" title={t('gn.jn.empty')} hint={t('gn.jn.emptyHint')} />}
      {items && items.length > 0 && (
        <ul className="divide-y divide-line">
          {items.map((e) => (
            <li key={e.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3">
              <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft text-base" title={t(`gn.jn.f.${e.kind}` as 'gn.jn.f.all')}>{KIND_ICON[e.kind]}</span>
              <div className="min-w-0 flex-1 basis-60">
                <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
                  {e.kind === 'restart'
                    ? <span className={RESTART_STATUS[e.status]?.cls ?? 'pill pill-mute'}>{RESTART_STATUS[e.status] ? t(RESTART_STATUS[e.status].text) : e.status}</span>
                    : e.kind === 'mod'
                      ? <span className={e.status === 'unban' ? 'pill pill-ok' : 'pill pill-warn'}>{t(`gn.md.k.${e.status}` as 'gn.md.k.kick')}</span>
                      : e.kind === 'link'
                      ? <span className="pill pill-ok">{LINK_TEXT[e.status] ? t(LINK_TEXT[e.status]) : e.status}</span>
                      : <span className={MSG_STATUS[e.status]?.cls ?? 'pill pill-mute'}>{MSG_STATUS[e.status] ? t(MSG_STATUS[e.status].text) : e.status}</span>}
                  {e.serverName && <span>{e.serverName}</span>}
                  <span className="font-semibold text-mute">{soon(e.ts)}{e.by ? ` · ${e.by}` : ''}</span>
                </div>
                {e.kind === 'restart'
                  ? <p className="mt-1 text-sm">{t('gn.jn.restartLine', { n: e.text })}</p>
                  : e.kind === 'mod'
                    ? (
                      <p className="mt-1 text-sm">
                        <button type="button" className="font-bold underline decoration-dotted underline-offset-2 hover:text-link" title={t('gn.md.history')} onClick={() => onPlayer(e.text)}>{e.text}</button>
                        {e.error && <span className="font-semibold text-mute"> · {e.error}</span>}
                      </p>
                    )
                  : e.kind === 'link'
                    ? <p className="mt-1 text-sm">{e.text}</p>
                    : <p className="mt-1 wrap-break-word text-sm"><Styled text={e.text} /></p>}
                {e.kind !== 'mod' && (e.status === 'failed' || e.status === 'expired') && e.error && <p className="text-sm font-semibold text-danger">{e.error}</p>}
              </div>
              {(e.kind === 'message' || e.kind === 'auto') && <button type="button" className="btn btn-soft btn-sm" onClick={() => onReuse(e.text)}>{t('gn.reuse')}</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
