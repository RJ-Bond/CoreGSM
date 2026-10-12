import { useState } from 'react';
import { confirmDialog } from '../confirm';
import { api, type NewsItem, type NewsSettings, type PublicNews } from '../api';
import { useAuth } from '../auth';
import { EmbedView, type DiscordEmbed } from './EmbedPreview';
import { ChannelPicker } from '../components/ChannelPicker';
import { NewsArt } from '../components/Illustrations';
import { Empty, ErrorLine, IconNews, PageHead, fmtDateTime, toast, usePoll } from '../ui';
import NewsEditor, { TEMPLATES } from './NewsEditor';

// the editor (administrators, inside the admin area); everybody else reads NewsFeed
export default function NewsPage({ sub }: { sub: string }) {
  if (sub === 'new' || sub.startsWith('new/')) return <NewsEditor id={null} template={sub.slice(4)} />;
  const id = Number(sub);
  if (sub && Number.isInteger(id) && id > 0) return <NewsEditor id={id} />;
  return <NewsList />;
}

const BUSY = new Set(['queued', 'sending', 'edit_queued', 'delete_queued']);

function StatusPill({ n }: { n: NewsItem }) {
  switch (n.status) {
    case 'draft': return <span className="pill pill-mute">ЧЕРНОВИК</span>;
    case 'scheduled': return <span className="pill pill-warn">ЗАПЛАНИРОВАНО{n.scheduledAt ? ` · ${fmtDateTime(n.scheduledAt)}` : ''}</span>;
    case 'queued': case 'sending': return <span className="pill pill-warn">ОТПРАВЛЯЕТСЯ</span>;
    case 'edit_queued': return <span className="pill pill-warn">ОБНОВЛЯЕТСЯ</span>;
    case 'delete_queued': return <span className="pill pill-warn">УДАЛЯЕТСЯ</span>;
    case 'sent': return <span className="pill pill-ok">ОПУБЛИКОВАНО{n.sentAt ? ` · ${fmtDateTime(n.sentAt)}` : ''}</span>;
    default: return <span className="pill pill-bad">ОШИБКА</span>;
  }
}

/** a short plain-text teaser: markdown marks removed */
const excerpt = (n: NewsItem) => {
  const raw = n.payload.embed?.description || n.payload.content || '';
  return raw.replace(/^\s*[-*•]\s+/gm, '• ').replace(/[*_~`|>#]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 170);
};

function NewsList() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [settings, setSettings] = useState<NewsSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);

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

  const publish = async (n: NewsItem) => {
    await api(`/news/${n.id}/publish`, 'POST').then(() => toast('Новость отправляется в Discord')).catch((e) => setError(e.message));
    void load();
  };
  const copy = async (n: NewsItem) => {
    await api('/news', 'POST', { channelId: n.channelId, payload: n.payload, action: 'draft' }).then(() => toast('Копия сохранена как черновик')).catch((e) => setError(e.message));
    void load();
  };
  const remove = async (n: NewsItem) => {
    const sent = n.status === 'sent';
    if (!(await confirmDialog({ title: 'Удалить новость?', text: sent ? 'Сообщение также будет удалено из Discord.' : undefined, confirmLabel: 'Удалить', danger: true }))) return;
    await api(`/news/${n.id}`, 'DELETE').then(() => toast('Новость удалена')).catch((e) => setError(e.message));
    void load();
  };

  return (
    <div className="space-y-6">
      <PageHead icon={<IconNews />} title="Новости" subtitle="Публикации от имени бота в Discord">
        <a className="btn" href="#/admin/news/new" data-magnetic>+ Написать новость</a>
      </PageHead>
      <ErrorLine text={error} />

      <div className="panel flex flex-wrap items-center gap-2 px-5 py-3">
        <span className="mr-1 text-sm font-extrabold text-mute">Быстрая новость:</span>
        {TEMPLATES.map((t) => <a key={t.id} className="btn btn-soft btn-sm" href={`#/admin/news/new/${t.id}`}>{t.label}</a>)}
      </div>

      <div className="panel flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-mute">Канал новостей по умолчанию</div>
          <div className="font-black">
            {settings?.channelId ? (settings.channelName ? `# ${settings.channelName}${settings.guildName ? ` · ${settings.guildName}` : ''}` : `Канал ${settings.channelId}`) : 'не выбран'}
          </div>
        </div>
        <button className="btn btn-soft btn-sm" onClick={() => setChanging((v) => !v)}>{settings?.channelId ? 'Изменить' : 'Выбрать канал'}</button>
        {changing && (
          <div className="w-full">
            <ChannelPicker id="news-default-channel" value={settings?.channelId ?? ''} onChange={(v) => void setChannel(v)} />
          </div>
        )}
      </div>

      {loaded && items.length === 0 && (
        <Empty art={<NewsArt />} title="Новостей пока нет" text="Напишите первую новость: выберите шаблон, отредактируйте текст и опубликуйте сразу или по расписанию.">
          <a className="btn mt-3" href="#/admin/news/new">+ Написать новость</a>
        </Empty>
      )}

      {!loaded && (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Загрузка">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton panel h-[188px]" />)}
        </div>
      )}

      <div className="fade-in grid gap-4 md:grid-cols-2">
        {items.map((n) => {
          const color = `#${(n.payload.embed?.color ?? 0x5865f2).toString(16).padStart(6, '0')}`;
          return (
            <article key={n.id} className="panel flex flex-col gap-3 overflow-hidden p-5" style={{ borderTop: `4px solid ${color}` }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusPill n={n} />
                  {n.repeat && n.repeat !== 'none' && <span className="pill pill-mute">⟳ {n.repeat === 'daily' ? 'КАЖДЫЙ ДЕНЬ' : n.repeat === 'weekly' ? 'КАЖДУЮ НЕДЕЛЮ' : 'КАЖДЫЙ МЕСЯЦ'}</span>}
                </div>
                <span className="truncate text-sm font-bold text-mute" title={n.channelId}>{n.channelName ? `# ${n.channelName}` : `Канал ${n.channelId}`}</span>
              </div>
              <h3 className="line-clamp-2 break-words text-lg font-black leading-tight">{n.title}</h3>
              {excerpt(n) && <p className="line-clamp-3 break-words text-sm font-semibold text-mute">{excerpt(n)}</p>}
              {n.error && <p className="rounded-xl bg-badbg px-3 py-2 text-sm font-bold text-bad">{n.error}</p>}
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <a className="btn btn-soft btn-sm" href={`#/admin/news/${n.id}`}>Изменить</a>
                {['draft', 'scheduled', 'error'].includes(n.status) && <button className="btn btn-soft btn-sm" onClick={() => publish(n)}>Опубликовать сейчас</button>}
                {n.messageUrl && <a className="btn btn-soft btn-sm" href={n.messageUrl} target="_blank" rel="noreferrer">Открыть в Discord ↗</a>}
                <button className="btn btn-soft btn-sm" onClick={() => copy(n)}>Копия</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(n)}>Удалить</button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/** stored embed -> what EmbedView draws (an uploaded picture is served by the panel) */
function toView(e: PublicNews['payload']['embed']): DiscordEmbed | null {
  if (!e) return null;
  const src = e.image?.upload ? `/api/news/images/${e.image.upload}` : e.image?.url;
  return { ...e, image: src ? { url: src } : undefined } as DiscordEmbed;
}

/** read-only feed for players and guests: only what has been posted */
export function NewsFeed() {
  const [items, setItems] = useState<PublicNews[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  usePoll(() => api<PublicNews[]>('/news').then((n) => { setItems(n); setError(''); }).catch((e) => setError(e.message)).finally(() => setLoaded(true)), 30_000);

  return (
    <div className="space-y-6">
      <PageHead icon={<IconNews />} title="Новости" subtitle="Последние объявления" />
      <ErrorLine text={error} />
      {loaded && items.length === 0 && <Empty art={<NewsArt />} title="Новостей пока нет" text="Когда администратор что-нибудь опубликует, это появится здесь." />}
      {!loaded && (
        <div className="mx-auto max-w-2xl space-y-4" aria-busy="true" aria-label="Загрузка">
          {[0, 1].map((i) => <div key={i} className="skeleton panel h-52" />)}
        </div>
      )}
      <div className="fade-in mx-auto max-w-2xl space-y-4">
        {items.map((n) => (
          <article key={n.id} className="panel space-y-2 p-4">
            {n.sentAt && <div className="text-sm font-bold text-mute">{fmtDateTime(n.sentAt)}</div>}
            <EmbedView embed={toView(n.payload.embed)} content={n.payload.content} />
          </article>
        ))}
      </div>
    </div>
  );
}
