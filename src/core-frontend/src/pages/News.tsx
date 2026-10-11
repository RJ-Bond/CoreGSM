import { useState } from 'react';
import { api, type NewsItem, type NewsSettings } from '../api';
import { ChannelPicker } from '../components/ChannelPicker';
import { Empty, ErrorLine, PageHead, fmtDateTime, usePoll } from '../ui';
import NewsEditor from './NewsEditor';

export default function NewsPage({ sub }: { sub: string }) {
  if (sub === 'new') return <NewsEditor id={null} />;
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
  return raw.replace(/^s*[-*•]s+/gm, '• ').replace(/[*_~`|>#]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 170);
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
    await api(`/news/${n.id}/publish`, 'POST').catch((e) => setError(e.message));
    void load();
  };
  const copy = async (n: NewsItem) => {
    await api('/news', 'POST', { channelId: n.channelId, payload: n.payload, action: 'draft' }).catch((e) => setError(e.message));
    void load();
  };
  const remove = async (n: NewsItem) => {
    const sent = n.status === 'sent';
    if (!window.confirm(sent ? 'Удалить новость? Сообщение также будет удалено из Discord.' : 'Удалить новость?')) return;
    await api(`/news/${n.id}`, 'DELETE').catch((e) => setError(e.message));
    void load();
  };

  return (
    <div className="space-y-6">
      <PageHead title="Новости" subtitle="Публикации от имени бота в Discord">
        <a className="btn" href="#/news/new">+ Написать новость</a>
      </PageHead>
      <ErrorLine text={error} />

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
        <Empty title="Новостей пока нет" text="Напишите первую новость: выберите шаблон, отредактируйте текст и опубликуйте сразу или по расписанию.">
          <a className="btn mt-3" href="#/news/new">+ Написать новость</a>
        </Empty>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((n) => {
          const color = `#${(n.payload.embed?.color ?? 0x5865f2).toString(16).padStart(6, '0')}`;
          return (
            <article key={n.id} className="panel flex flex-col gap-3 overflow-hidden p-5" style={{ borderTop: `4px solid ${color}` }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StatusPill n={n} />
                <span className="truncate text-sm font-bold text-mute" title={n.channelId}>{n.channelName ? `# ${n.channelName}` : `Канал ${n.channelId}`}</span>
              </div>
              <h3 className="line-clamp-2 break-words text-lg font-black leading-tight">{n.title}</h3>
              {excerpt(n) && <p className="line-clamp-3 break-words text-sm font-semibold text-mute">{excerpt(n)}</p>}
              {n.error && <p className="rounded-xl bg-badbg px-3 py-2 text-sm font-bold text-bad">{n.error}</p>}
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <a className="btn btn-soft btn-sm" href={`#/news/${n.id}`}>Изменить</a>
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
