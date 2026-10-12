import { useState } from 'react';
import { api } from '../api';
import { ChannelPicker } from '../components/ChannelPicker';
import { ErrorLine, PageHead, ago, toast, usePoll } from '../ui';

interface AlertsInfo {
  enabled: boolean;
  channelId: string;
  channelName: string | null;
  guildName: string | null;
  afterMin: number;
  mention: 'none' | 'here' | 'everyone';
  recent: { id: number; kind: 'down' | 'up' | 'test'; serverName: string; status: string; error: string | null; createdAt: number; sentAt: number | null }[];
}

const IconBell = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);
export { IconBell };

const KIND = {
  down: { label: 'Сервер упал', cls: 'pill-bad' },
  up: { label: 'Сервер вернулся', cls: 'pill-ok' },
  test: { label: 'Проверка', cls: 'pill-mute' },
} as const;

/** Messages to a Discord channel when a game server stops answering and when it is back. */
export default function AlertsPage() {
  const [info, setInfo] = useState<AlertsInfo | null>(null);
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);

  const load = () => api<AlertsInfo>('/alerts').then((a) => { setInfo(a); setError(''); }).catch((e: Error) => setError(e.message));
  usePoll(load, 10_000);

  const save = async (patch: Partial<Pick<AlertsInfo, 'enabled' | 'channelId' | 'afterMin' | 'mention'>>, done?: string) => {
    await api<AlertsInfo>('/alerts', 'PUT', patch)
      .then((a) => { setInfo(a); setError(''); if (done) toast(done); })
      .catch((e: Error) => setError(e.message));
  };
  const test = async () => {
    await api<AlertsInfo>('/alerts/test', 'POST').then((a) => { setInfo(a); toast('Тестовое сообщение поставлено в очередь'); }).catch((e: Error) => setError(e.message));
  };

  return (
    <div className="space-y-5">
      <PageHead icon={<IconBell />} title="Оповещения" subtitle="Сообщение в Discord, когда игровой сервер перестал отвечать и когда вернулся" />
      <ErrorLine text={error} />

      {info && (
        <div className="panel space-y-5 p-6">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-brand" checked={info.enabled} onChange={(e) => void save({ enabled: e.target.checked }, e.target.checked ? 'Оповещения включены' : 'Оповещения выключены')} />
            <span>
              <span className="block font-extrabold">Оповещать о недоступности серверов</span>
              <span className="block text-sm font-semibold text-mute">Бот напишет в выбранный канал, а когда сервер вернётся, сообщит об этом и покажет, сколько он простоял.</span>
            </span>
          </label>

          <div>
            <span className="label">Канал для оповещений</span>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-black">{info.channelId ? (info.channelName ? `# ${info.channelName}${info.guildName ? ` · ${info.guildName}` : ''}` : `Канал ${info.channelId}`) : 'не выбран'}</span>
              <button className="btn btn-soft btn-sm" onClick={() => setChanging((v) => !v)}>{info.channelId ? 'Изменить' : 'Выбрать канал'}</button>
            </div>
            {changing && (
              <div className="mt-3">
                <ChannelPicker id="alerts-channel" value={info.channelId} onChange={(v) => { if (/^\d{15,25}$/.test(v)) { void save({ channelId: v }, 'Канал сохранён'); setChanging(false); } }} />
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="alerts-after" className="label">Считать сервер упавшим через</label>
              <select id="alerts-after" className="input" value={info.afterMin} onChange={(e) => void save({ afterMin: Number(e.target.value) }, 'Сохранено')}>
                {[1, 2, 3, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} {m === 1 ? 'минуту' : m < 5 ? 'минуты' : 'минут'} без ответа</option>)}
              </select>
              <p className="mt-1 text-sm font-semibold text-mute">Короткие сбои короче этого времени не отправляют сообщение.</p>
            </div>
            <div>
              <label htmlFor="alerts-mention" className="label">Кого упоминать при падении</label>
              <select id="alerts-mention" className="input" value={info.mention} onChange={(e) => void save({ mention: e.target.value as AlertsInfo['mention'] }, 'Сохранено')}>
                <option value="none">Никого</option>
                <option value="here">@here (кто в сети)</option>
                <option value="everyone">@everyone</option>
              </select>
              <p className="mt-1 text-sm font-semibold text-mute">Сообщение о возвращении сервера всегда без упоминания.</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn btn-soft" onClick={() => void test()} disabled={!info.channelId}>Отправить тестовое сообщение</button>
          </div>
        </div>
      )}

      <div className="panel space-y-3 p-6">
        <h2 className="text-lg font-black">Последние оповещения</h2>
        {info && info.recent.length === 0 && <p className="font-semibold text-mute">Пока ничего не отправлялось.</p>}
        <ul className="divide-y divide-line">
          {info?.recent.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className={`pill ${KIND[r.kind].cls}`}>{KIND[r.kind].label}</span>
              <span className="min-w-0 flex-1 truncate font-bold">{r.serverName}</span>
              {r.status === 'sent' && <span className="text-sm font-semibold text-mute">отправлено {ago(r.sentAt)}</span>}
              {(r.status === 'queued' || r.status === 'sending') && <span className="text-sm font-semibold text-warn">ждёт бота…</span>}
              {r.status === 'error' && <span className="text-sm font-bold text-bad" title={r.error ?? ''}>не отправлено: {r.error}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
