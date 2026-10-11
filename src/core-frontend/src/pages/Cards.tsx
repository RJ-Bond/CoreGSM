import { useState } from 'react';
import { api, type Server } from '../api';
import { Empty, ErrorLine, PageHead, usePoll } from '../ui';

export default function CardsPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState('');

  usePoll(() => {
    api<Server[]>('/servers').then(setServers).catch((e) => setError(e.message)).finally(() => setLoaded(true));
    setTick((t) => t + 1);
  }, 15_000);

  const copy = async (s: Server) => {
    const url = `${window.location.origin}/api/card/${s.id}.png`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(s.id);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      window.prompt('Ссылка на картинку', url);
    }
  };

  return (
    <div className="space-y-6">
      <PageHead title="Карточки" subtitle="Картинки, которые бот публикует в Discord. Ссылка открыта, её можно вставить куда угодно." />
      <ErrorLine text={error} />
      {loaded && servers.length === 0 && <Empty title="Карточек пока нет" text="Сначала добавьте сервер на вкладке «Серверы»." />}
      <div className="grid gap-5 xl:grid-cols-2">
        {servers.map((s) => (
          <div key={s.id} className="panel space-y-3 p-4">
            <img src={`/api/card/${s.id}.png?t=${tick}`} alt={`Карточка ${s.name}`} className="w-full rounded-2xl bg-soft" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-black">{s.name}</span>
              <div className="flex gap-2">
                <button className="btn btn-soft btn-sm" onClick={() => copy(s)}>{copied === s.id ? 'Скопировано' : 'Копировать ссылку'}</button>
                <a className="btn btn-soft btn-sm" href={`/api/card/${s.id}.png`} target="_blank" rel="noreferrer">Открыть</a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
