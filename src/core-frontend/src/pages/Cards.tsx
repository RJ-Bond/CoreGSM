import { useRef, useState, useEffect } from 'react';
import { api, type Server } from '../api';
import { CardsArt } from '../components/Illustrations';
import { promptDialog } from '../confirm';
import { AdminPage, Burst, Empty, ErrorLine, IconCards, LoadError, IconCheck, IconCopy, IconRefresh, PageHead, toast, usePoll } from '../ui';

export default function CardsPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loaded, setLoaded] = useState(false);
  // bumped by the "Обновить" button only; otherwise a picture is reloaded when the server's own data changed (updatedAt)
  const [forced, setForced] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState('');
  const copyTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const load = () =>
    api<Server[]>('/servers')
      .then((s) => { setServers(s); setError(''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  usePoll(load, 15_000);

  const copy = async (s: Server) => {
    const url = `${window.location.origin}/api/card/${s.id}.png`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(s.id);
      toast('Ссылка скопирована');
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(null), 1800);
    } catch {
      await promptDialog({ title: 'Ссылка на картинку', label: 'Скопируйте ссылку', value: url, readOnly: true });
    }
  };

  const [spin, setSpin] = useState(false);
  const refresh = () => {
    setForced((n) => n + 1);
    setSpin(true);
    void load().finally(() => window.setTimeout(() => setSpin(false), 500));
  };

  return (
    <AdminPage
      head={(
        <PageHead
          icon={<IconCards />}
          title="Карточки"
          subtitle="Картинки состояния серверов"
          hint="Карточка — это картинка с онлайном сервера, которая обновляется сама. Ссылку на неё можно вставить на сайт или в чат."
          help={<p>Ссылка открыта: картинку видят все, у кого она есть. Бот использует такие же карточки в сообщениях Discord, если выбран стиль «Картинка» (раздел «Discord»).</p>}
        >
          <button className="btn btn-soft" onClick={refresh} aria-busy={spin || undefined}><IconRefresh spinning={spin} />Обновить</button>
        </PageHead>
      )}
    >
      {error && servers.length === 0 ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}
      {!loaded && (
        <div className="grid gap-5 xl:grid-cols-2" aria-busy="true" aria-label="Загрузка">
          {[0, 1].map((i) => <div key={i} className="skeleton panel h-[330px]" />)}
        </div>
      )}
      {loaded && !error && servers.length === 0 && (
        <Empty art={<CardsArt />} title="Карточек пока нет" text="Сначала добавьте сервер на вкладке «Серверы»: для каждого появится своя картинка.">
          <a className="btn mt-3" href="#/admin/servers/new">Добавить сервер</a>
        </Empty>
      )}
      <div className="fade-in grid gap-5 xl:grid-cols-2">
        {servers.map((s) => (
          <div key={s.id} className="panel space-y-3 p-5">
            <img src={`/api/card/${s.id}.png?v=${s.updatedAt ?? 0}&r=${forced}`} alt={`Карточка ${s.name}`} loading="lazy" className="w-full rounded-ui-lg bg-soft" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-words font-black">{s.name}</span>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-soft btn-sm" onClick={() => void copy(s)}>
                  <span className="copy-ico" data-done={copied === s.id} aria-hidden>
                    <span className="ico-copy inline-grid"><IconCopy /></span>
                    <IconCheck size={16} className="ico-check" />
                    {copied === s.id && <Burst />}
                  </span>
                  {copied === s.id ? 'Скопировано' : 'Копировать ссылку'}
                </button>
                <a className="btn btn-soft btn-sm" href={`/api/card/${s.id}.png`} target="_blank" rel="noreferrer">Открыть</a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </AdminPage>
  );
}
