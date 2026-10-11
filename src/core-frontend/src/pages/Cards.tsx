import { useState } from 'react';
import { api, type Server } from '../api';
import { ErrorLine, PageHead, usePoll } from '../ui';

export default function CardsPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState('');

  usePoll(() => {
    api<Server[]>('/servers').then(setServers).catch((e) => setError(e.message));
    setTick((t) => t + 1);
  }, 15_000);

  const copy = async (s: Server) => {
    const url = `${window.location.origin}/api/card/${s.id}.png`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(s.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt('Ссылка на картинку', url);
    }
  };

  return (
    <div className="space-y-5">
      <PageHead title="cards" />
      <p className="max-w-2xl text-mute">PNG-карточки, которые бот публикует в Discord. Ссылка открыта для всех, поэтому её можно вставить в любой канал или на сайт.</p>
      <ErrorLine text={error} />
      <div className="grid gap-4 xl:grid-cols-2">
        {servers.map((s) => (
          <div key={s.id} className="space-y-2 rounded border border-line bg-panel p-3">
            <img src={`/api/card/${s.id}.png?t=${tick}`} alt={`Карточка ${s.name}`} className="w-full rounded" />
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-mute">/api/card/{s.id}.png</span>
              <div className="flex gap-2">
                <button className="btn btn-ghost !py-0.5" onClick={() => copy(s)}>{copied === s.id ? 'Скопировано' : 'Копировать ссылку'}</button>
                <a className="btn btn-ghost !py-0.5" href={`/api/card/${s.id}.png`} target="_blank" rel="noreferrer">Открыть</a>
              </div>
            </div>
          </div>
        ))}
        {servers.length === 0 && <p className="text-mute">Сначала добавьте сервер на вкладке «Серверы».</p>}
      </div>
    </div>
  );
}
