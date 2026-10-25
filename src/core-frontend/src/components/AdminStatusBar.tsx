import { useState } from 'react';
import { api, type Server } from '../api';
import { Button, ago, toast, usePoll } from '../ui';

/** The strip at the top of the admin area: is the polling alive, when was the last poll, poll everything now */
export default function AdminStatusBar() {
  const [servers, setServers] = useState<Server[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => setServers(await api<Server[]>('/servers').catch(() => null));
  usePoll(load, 20_000);

  if (!servers || servers.length === 0) return null;
  const last = servers.reduce((m, s) => Math.max(m, s.updatedAt ?? 0), 0);
  const stale = last > 0 && Date.now() - last > 5 * 60_000;
  const down = servers.filter((s) => !s.online && s.hasStatus && !s.maintenance).length;
  const tone = stale ? 'warn' : down > 0 ? 'bad' : 'ok';
  const text = stale ? 'Опрос давно не отвечает' : down > 0 ? `Недоступно серверов: ${down}` : 'Опрос идёт, всё отвечает';

  const pollAll = async () => {
    setBusy(true);
    await Promise.allSettled(servers.map((s) => api(`/servers/${s.id}/refresh`, 'POST')));
    toast('Серверы опрошены');
    await load();
    setBusy(false);
  };

  return (
    <div className="adm-status" role="status">
      <span className={`adm-status-dot is-${tone}`} aria-hidden />
      <span className="font-extrabold">{text}</span>
      {last > 0 && <span className="text-mute" title="Время последнего опроса">· {ago(last)}</span>}
      <Button type="button" size="sm" variant="soft" className="ml-auto" loading={busy} onClick={() => void pollAll()}>Опросить всё</Button>
    </div>
  );
}
