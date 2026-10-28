import { Switch } from '../components/Switch';
import { useState } from 'react';
import { t, useI18n } from '../i18n';
import { NewsCalendar } from '../components/news/Calendar';
import { confirmDialog } from '../confirm';
import { api, ApiError, type NewsItem, type NewsSettings, type PublicNews } from '../api';
import { useAuth } from '../auth';
import { EmbedView, type DiscordEmbed } from './EmbedPreview';
import { ChannelName, ChannelPicker } from '../components/ChannelPicker';
import { NewsArt } from '../components/Illustrations';
import { AdminPage, Empty, ErrorLine, GoLink, LoadError, IconCopyPlus, IconNews, IconTrash, PageHead, Strip, fmtDateTime, toast, undoable, usePoll, navigate, errText } from '../ui';
import NewsEditor, { TEMPLATES } from './NewsEditor';
import { newsImage } from '../components/news/newsLogic';
import { NewsStatsModal } from '../components/news/NewsStats';
import ArtPic from '../components/ArtPic';

// the editor (administrators, inside the admin area); everybody else reads NewsFeed
export default function NewsPage({ sub }: { sub: string }) {
  if (sub === 'new' || sub.startsWith('new/')) return <NewsEditor id={null} template={sub.slice(4)} />;
  const id = Number(sub);
  if (sub && Number.isInteger(id) && id > 0) return <NewsEditor id={id} />;
  return <NewsList />;
}

const BUSY = new Set(['queued', 'sending', 'edit_queued', 'delete_queued']);

function StatusPill({ n }: { n: NewsItem }) {
  useI18n();
  switch (n.status) {
    case 'draft': return <span className="pill pill-mute">{t('d2.news.st.draft')}</span>;
    case 'scheduled': return <span className="pill pill-warn">{t('d2.news.st.scheduled')}{n.scheduledAt ? ` · ${fmtDateTime(n.scheduledAt)}` : ''}</span>;
    case 'queued': case 'sending': return <span className="pill pill-warn">{t('d2.news.st.sending')}</span>;
    case 'edit_queued': return <span className="pill pill-warn">{t('d2.news.st.updating')}</span>;
    case 'delete_queued': return <span className="pill pill-warn">{t('d2.news.st.deleting')}</span>;
    case 'sent': return <span className="pill pill-ok">{t('d2.news.st.sent')}{n.sentAt ? ` · ${fmtDateTime(n.sentAt)}` : ''}</span>;
    default: return <span className="pill pill-bad">{t('d2.news.st.error')}</span>;
  }
}

/** a short plain-text teaser: markdown marks removed */
const excerpt = (n: NewsItem) => {
  const raw = n.payload.embed?.description || n.payload.content || '';
  return raw.replace(/^\s*[-*•]\s+/gm, '• ').replace(/[*_~`|>#]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 170);
};

function NewsList() {
  useI18n();
  const [items, setItems] = useState<NewsItem[]>([]);
  // items removed with «Отменить» pending stay hidden until the request is sent
  const [hidden, setHidden] = useState<number[]>([]);
  const list = items.filter((n) => !hidden.includes(n.id));
  const [settings, setSettings] = useState<NewsSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [stats, setStats] = useState<{ id: number; title: string } | null>(null);
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [changingTest, setChangingTest] = useState(false);
  const [view, setView] = useState<'list' | 'calendar'>(() => {
    try { return localStorage.getItem('news_view') === 'calendar' ? 'calendar' : 'list'; } catch { return 'list'; }
  });
  const pickView = (v: 'list' | 'calendar') => {
    setView(v);
    try { localStorage.setItem('news_view', v); } catch { /* ignore */ }
  };

  const load = () =>
    Promise.all([api<NewsItem[]>('/news'), api<NewsSettings>('/news/settings')])
      .then(([n, s]) => { setItems(n); setSettings(s); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  // while something is being sent, look more often
  usePoll(load, items.some((n) => BUSY.has(n.status)) ? 3_000 : 15_000);

  const setChannel = async (channelId: string) => {
    if (!/^\d{15,25}$/.test(channelId)) return;
    await api('/news/settings', 'PUT', { channelId }).catch((e) => setError(e.message));
    setChanging(false);
    void load();
  };

  const setCrosspost = async (crosspost: boolean) => {
    await api('/news/settings', 'PUT', { crosspost }).catch((e) => setError(e.message));
    void load();
  };

  const publish = async (n: NewsItem) => {
    await api(`/news/${n.id}/publish`, 'POST').then(() => toast(t('d2.news.t.publishing'))).catch((e) => setError(e.message));
    void load();
  };
  const setTestChannel = async (testChannelId: string) => {
    if (testChannelId && !/^\d{15,25}$/.test(testChannelId)) return;
    await api('/news/settings', 'PUT', { testChannelId }).catch((e) => setError(e.message));
    setChangingTest(false);
    void load();
  };
  const copy = async (n: NewsItem) => {
    try {
      const created = await api<NewsItem>(`/news/${n.id}/duplicate`, 'POST');
      toast(t('d2.news.t.copied'));
      navigate(`/admin/news/${created.id}`);
      return;
    } catch (e) {
      // an older backend has no duplicate route: make the copy by hand
      if (!(e instanceof ApiError && (e.status === 404 || e.status === 405))) { setError(errText(e)); return; }
    }
    await api('/news', 'POST', { channelId: n.channelId, payload: n.payload, action: 'draft' }).then(() => toast(t('d2.news.t.copyDraft'))).catch((e) => setError(e.message));
    void load();
  };
  const reschedule = async (n: NewsItem, day: Date) => {
    const base = n.scheduledAt ? new Date(n.scheduledAt) : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0);
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), base.getHours(), base.getMinutes()).getTime();
    if (at <= Date.now()) { toast(t('d2.news.t.past'), 'err'); return; }
    await api(`/news/${n.id}/schedule`, 'PATCH', { scheduledAt: at })
      .then(() => toast(t('d2.news.t.moved', { when: fmtDateTime(at) })))
      .catch((e) => setError(e.message));
    void load();
  };
  const togglePin = async (n: NewsItem) => {
    await api(`/news/${n.id}/pin`, 'PATCH', { pinned: !n.pinned }).then(() => toast(n.pinned ? t('d2.news.t.unpinned') : t('d2.news.t.pinnedTop'))).catch((e) => setError(e.message));
    void load();
  };
  const pick = (id: number) => setPicked((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const chosen = list.filter((n) => picked.includes(n.id));
  const bulk = async (kind: 'publish' | 'pin' | 'unpin' | 'delete') => {
    if (chosen.length === 0) return;
    if (kind === 'delete') {
      const sent = chosen.filter((n) => n.status === 'sent').length;
      if (!(await confirmDialog({ title: t('d2.news.c.bulkTitle', { n: chosen.length }), text: sent ? t('d2.news.c.bulkText', { n: sent }) : undefined, confirmLabel: t('d2.news.delete'), danger: true }))) return;
    }
    setBulkBusy(true);
    const todo = kind === 'publish' ? chosen.filter((n) => ['draft', 'scheduled', 'error'].includes(n.status))
      : kind === 'pin' ? chosen.filter((n) => !n.pinned) : kind === 'unpin' ? chosen.filter((n) => n.pinned) : chosen;
    const res = await Promise.allSettled(todo.map((n) => (kind === 'publish' ? api(`/news/${n.id}/publish`, 'POST') : kind === 'delete' ? api(`/news/${n.id}`, 'DELETE') : api(`/news/${n.id}/pin`, 'PATCH', { pinned: kind === 'pin' }))));
    const bad = res.filter((r) => r.status === 'rejected').length;
    const verb = { publish: t('d2.news.v.publish'), pin: t('d2.news.v.pin'), unpin: t('d2.news.v.unpin'), delete: t('d2.news.v.delete') }[kind];
    toast(bad ? t('d2.news.t.bulkBad', { verb, ok: todo.length - bad, bad }) : todo.length ? t('d2.news.t.bulkOk', { verb, n: todo.length }) : t('d2.news.t.bulkNone'), bad ? 'err' : undefined);
    setPicked([]);
    setBulkBusy(false);
    void load();
  };
  const remove = async (n: NewsItem) => {
    const sent = n.status === 'sent';
    // a published news item also removes the Discord message: that stays behind a confirmation
    if (sent || BUSY.has(n.status)) {
      if (!(await confirmDialog({ title: t('d2.news.c.title'), text: sent ? t('d2.news.c.text') : undefined, confirmLabel: t('d2.news.delete'), danger: true }))) return;
      await api(`/news/${n.id}`, 'DELETE').then(() => toast(t('d2.news.t.deleted'))).catch((e) => setError(e.message));
      void load();
      return;
    }
    // a draft or a scheduled item never reached Discord: it disappears at once and can be taken back for 6 s
    setHidden((h) => [...h, n.id]);
    undoable({
      text: t('d2.news.t.deletedNamed', { title: n.title }),
      restore: () => setHidden((h) => h.filter((x) => x !== n.id)),
      commit: async () => {
        try {
          await api(`/news/${n.id}`, 'DELETE');
        } catch (e) {
          setError(errText(e));
          toast(t('d2.news.t.deleteFail'), 'err');
        }
        setHidden((h) => h.filter((x) => x !== n.id));
        void load();
      },
    });
  };

  return (
    <AdminPage
      head={(
        <PageHead
          icon={<IconNews />}
          title={t('d2.news.title')}
          subtitle={t('d2.news.subtitle')}
          hint={t('d2.news.hint')}
          help={<p>{t('d2.news.help')}</p>}
        >
          <a className="btn" href="/admin/news/new" data-magnetic data-tour="news-new">{t('d2.news.write')}</a>
        </PageHead>
      )}
    >
      {error && list.length === 0 ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}

      <Strip className="justify-start!">
        <span className="mr-1 text-sm font-extrabold text-mute">{t('d2.news.quick')}</span>
        {TEMPLATES.map((t) => <a key={t.id} className="btn btn-soft btn-sm" href={`/admin/news/new/${t.id}`}>{t.label}</a>)}
      </Strip>

      <Strip>
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-mute">{t('d2.news.defChannel')}</div>
          <div className="font-black">
            {settings?.channelId ? (settings.channelName ? `# ${settings.channelName}${settings.guildName ? ` · ${settings.guildName}` : ''}`   : <ChannelName id={settings.channelId} />) : t('d2.news.notChosen')}
          </div>
        </div>
        <button className="btn btn-soft btn-sm" onClick={() => setChanging((v) => !v)} aria-expanded={changing}>{settings?.channelId ? t('d2.news.change') : t('d2.news.pickChannel')}</button>
        {changing && (
          <div className="w-full">
            <ChannelPicker id="news-default-channel" value={settings?.channelId ?? ''} onChange={(v) => void setChannel(v)} />
          </div>
        )}
      </Strip>

      <Strip>
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-mute">{t('d2.news.testChannel')}</div>
          <div className="font-black">
            {settings?.testChannelId ? (settings.testChannelName ? `# ${settings.testChannelName}${settings.testGuildName ? ` · ${settings.testGuildName}` : ''}` : t('d2.news.channelId', { id: settings.testChannelId })) : t('d2.news.notChosen')}
          </div>
          <div className="text-xs font-semibold text-mute">{t('d2.news.testHint')}</div>
        </div>
        <span className="flex gap-2">
          {settings?.testChannelId && <button className="btn btn-soft btn-sm" onClick={() => void setTestChannel('')}>{t('d2.news.reset')}</button>}
          <button className="btn btn-soft btn-sm" onClick={() => setChangingTest((v) => !v)} aria-expanded={changingTest}>{settings?.testChannelId ? t('d2.news.change') : t('d2.news.pickChannel')}</button>
        </span>
        {changingTest && (
          <div className="w-full">
            <ChannelPicker id="news-test-channel-setting" value={settings?.testChannelId ?? ''} onChange={(v) => { if (v) void setTestChannel(v); }} />
          </div>
        )}
      </Strip>

      <Strip>
        <label className="flex min-w-0 items-center gap-3 font-bold">
          <Switch id="news-crosspost" checked={!!settings?.crosspost} onChange={(on) => void setCrosspost(on)} />
          <span className="min-w-0">
            {t('news.crosspost')}
            <span className="block text-xs font-semibold text-mute">{t('news.crosspostHint')}</span>
          </span>
        </label>
      </Strip>

      <div className="seg" role="group" aria-label={t('d2.news.viewLabel')}>
        <button type="button" className="seg-item" aria-pressed={view === 'list'} onClick={() => pickView('list')}>{t('d2.news.viewList')}</button>
        <button type="button" className="seg-item" aria-pressed={view === 'calendar'} onClick={() => pickView('calendar')}>{t('d2.news.viewCal')}</button>
      </div>

      {view === 'calendar' && list.length > 0 && <NewsCalendar items={list} onMove={(n, day) => void reschedule(n, day)} />}

      {loaded && !error && list.length === 0 && (
        <Empty art={<ArtPic src="empty/empty-news" size={132} />} title={t('d2.news.empty')} text={t('d2.news.emptyText')}>
          <a className="btn mt-3" href="/admin/news/new">{t('d2.news.write')}</a>
        </Empty>
      )}

      {!loaded && (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label={t('d2.news.loading')}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton panel h-[188px]" />)}
        </div>
      )}

      {list.length > 1 && view === 'list' && (
        <div className="flex flex-wrap items-center gap-2 rounded-ui-lg bg-soft px-4 py-2.5">
          <label className="flex items-center gap-2 font-bold">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={picked.length === list.length} onChange={(e) => setPicked(e.target.checked ? list.map((n) => n.id) : [])} />
            {picked.length ? t('d2.news.picked', { n: picked.length }) : t('d2.news.pickAll')}
          </label>
          {picked.length > 0 && (
            <div className="ml-auto flex flex-wrap gap-2">
              <button className="btn btn-soft btn-sm" disabled={bulkBusy} onClick={() => void bulk('publish')}>{t('d2.news.publish')}</button>
              <button className="btn btn-soft btn-sm" disabled={bulkBusy} onClick={() => void bulk('pin')}>{t('d2.news.pin')}</button>
              <button className="btn btn-soft btn-sm" disabled={bulkBusy} onClick={() => void bulk('unpin')}>{t('d2.news.unpin')}</button>
              <button className="btn btn-danger btn-sm" disabled={bulkBusy} onClick={() => void bulk('delete')}>{t('d2.news.delete')}</button>
            </div>
          )}
        </div>
      )}

      <div className={`fade-in grid gap-4 md:grid-cols-2 ${view === 'calendar' ? 'hidden' : ''}`}>
        {list.map((n) => {
          const color = `#${(n.payload.embed?.color ?? 0x5865f2).toString(16).padStart(6, '0')}`;
          return (
            <article key={n.id} className={`panel flex flex-col gap-3 overflow-hidden p-5 ${picked.includes(n.id) ? 'ring-2 ring-brand/60' : ''}`} style={{ borderTop: `4px solid ${color}` }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {list.length > 1 && <input type="checkbox" className="h-4 w-4 shrink-0 accent-brand" checked={picked.includes(n.id)} onChange={() => pick(n.id)} aria-label={t('d2.news.pickOne', { title: n.title })} />}
                  <StatusPill n={n} />
                  {n.pinned && <span className="pill pill-ok">{t('d2.news.st.pinned')}</span>}
                  {n.repeat && n.repeat !== 'none' && <span className="pill pill-mute">⟳ {n.repeat === 'daily' ? t('d2.news.rep.daily') : n.repeat === 'weekly' ? t('d2.news.rep.weekly') : t('d2.news.rep.monthly')}</span>}
                </div>
                <span className="truncate text-sm font-bold text-mute" title={n.channelId}>{<ChannelName id={n.channelId} known={n.channelName} />}</span>
              </div>
              <div className="flex items-start gap-3">
                {newsImage(n.payload) && <img src={newsImage(n.payload) ?? ''} alt="" loading="lazy" className="nl-thumb" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                <div className="min-w-0 flex-1">
                  <h3 className="line-clamp-2 wrap-break-word text-lg font-black leading-tight">{n.title}</h3>
                  {excerpt(n) && <p className="mt-1 line-clamp-3 wrap-break-word text-sm font-semibold text-mute">{excerpt(n)}</p>}
                </div>
              </div>
              {(n.reactions ?? []).some((r) => r.count > 0) && (
                <p className="flex flex-wrap gap-1.5 text-sm font-bold" aria-label={t('d2.news.reactions')}>
                  {(n.reactions ?? []).filter((r) => r.count > 0).map((r) => <span key={r.emoji} className="nl-react">{r.emoji} {r.count}</span>)}
                </p>
              )}
              {n.error && <p className="rounded-xl bg-badbg px-3 py-2 text-sm font-bold text-bad">{n.error}</p>}
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <a className="btn btn-soft btn-sm" href={`/admin/news/${n.id}`}>{t('d2.news.change')}</a>
                <button className="btn btn-soft btn-sm" onClick={() => void copy(n)}>{t('d2.news.dup')}</button>
                <button className="btn btn-soft btn-sm" aria-pressed={!!n.pinned} onClick={() => void togglePin(n)}>{n.pinned ? t('d2.news.unpin') : t('d2.news.pin')}</button>
                {['draft', 'scheduled', 'error'].includes(n.status) && <button className="btn btn-soft btn-sm" onClick={() => publish(n)}>{t('d2.news.publishNow')}</button>}
                {['sent', 'edit_queued'].includes(n.status) && <button className="btn btn-soft btn-sm" onClick={() => setStats({ id: n.id, title: n.title })}>{t('d2.news.stats')}</button>}
                {n.messageUrl && <a className="btn btn-soft btn-sm" href={n.messageUrl} target="_blank" rel="noreferrer">{t('d2.news.openDiscord')}</a>}
                <span className="ml-auto flex items-center gap-1.5">
                  <button type="button" className="row-act" title={t('d2.news.dup')} aria-label={t('d2.news.dup')} onClick={() => void copy(n)}><IconCopyPlus /></button>
                  <button type="button" className="row-act row-act-danger" title={t('d2.news.delete')} aria-label={t('d2.news.delete')} onClick={() => void remove(n)}><IconTrash /></button>
                </span>
              </div>
            </article>
          );
        })}
      </div>
      {stats && <NewsStatsModal id={stats.id} title={stats.title} onClose={() => setStats(null)} />}
    </AdminPage>
  );
}

/** stored embed -> what EmbedView draws (an uploaded picture is served by the panel) */
function toView(e: PublicNews['payload']['embed']): DiscordEmbed | null {
  if (!e) return null;
  const src = e.image?.upload ? `/api/news/images/${e.image.upload}` : e.image?.url;
  return { ...e, image: src ? { url: src } : undefined } as DiscordEmbed;
}
