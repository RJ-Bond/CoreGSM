/** «Доступность из разных мест»: the server seen from the panel and from every probe, with a short verdict. */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { ago } from '../../ui';

interface Point { name: string; online: boolean | null; ping: number | null; updatedAt: number | null; uptime: number | null }
export interface ProbeView { panel: Point; probes: Point[] }

/** what the views together say */
export function verdict(v: ProbeView): { tone: 'ok' | 'warn' | 'bad' | 'mute'; text: string } {
  const known = [v.panel, ...v.probes].filter((p) => p.online !== null);
  if (!known.length) return { tone: 'mute', text: 'Пока нет свежих проверок' };
  const up = known.filter((p) => p.online);
  if (up.length === known.length) return { tone: 'ok', text: 'Сервер доступен отовсюду' };
  if (!up.length) return { tone: 'bad', text: 'Сервер не отвечает ни из одной точки' };
  return { tone: 'warn', text: `Доступен не отовсюду: не отвечает из ${known.filter((p) => !p.online).map((p) => `«${p.name}»`).join(', ')}. Похоже на проблему сети, а не сервера.` };
}

export function useProbes(serverId: number): ProbeView | null {
  const [v, setV] = useState<ProbeView | null>(null);
  useEffect(() => {
    let on = true;
    const load = () => api<ProbeView>(`/servers/${serverId}/probes`).then((x) => on && setV(x)).catch(() => undefined);
    void load();
    const t = window.setInterval(load, 60_000);
    return () => { on = false; window.clearInterval(t); };
  }, [serverId]);
  return v;
}

export default function ProbesView({ v }: { v: ProbeView }) {
  const vd = verdict(v);
  return (
    <div className="space-y-3">
      <p className={`rounded-xl px-3 py-2 text-sm font-bold ${vd.tone === 'ok' ? 'bg-okbg text-ok' : vd.tone === 'warn' ? 'bg-warnbg text-warn' : vd.tone === 'bad' ? 'bg-badbg text-bad' : 'bg-soft text-mute'}`}>{vd.text}</p>
      <ul className="pr-points">
        {[v.panel, ...v.probes].map((p, i) => (
          <li key={`${i}-${p.name}`} className="pr-point">
            <span className={`pr-dot ${p.online === null ? 'is-unknown' : p.online ? 'is-up' : 'is-down'}`} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-extrabold">{i === 0 ? '🖥 Панель' : `📍 ${p.name}`}</span>
              <span className="block text-xs font-bold text-mute">
                {p.online === null ? (p.updatedAt ? `нет данных с ${ago(p.updatedAt)}` : 'нет данных') : p.online ? (p.ping != null ? `${p.ping} мс` : 'отвечает') : 'не отвечает'}
                {p.uptime != null ? ` · ${String(p.uptime).replace('.', ',')}% за сутки` : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
