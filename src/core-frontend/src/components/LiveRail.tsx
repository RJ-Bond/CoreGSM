import { type Server } from '../api';
import { t, useI18n } from '../i18n';
import { useApiQuery } from '../ui/query';
import { StatusCards } from './news/NewsParts';

/** a column «now on the servers» for the pages that are otherwise a single narrow list: the busiest servers with their players */
export default function LiveRail() {
  useI18n();
  const { data } = useApiQuery<Server[]>('/servers', { pollMs: 30_000 });
  if (!data || data.length === 0) return null;
  const ids = [...data].sort((a, b) => Number(b.online) - Number(a.online) || b.players - a.players).slice(0, 8).map((s) => s.id);
  return (
    <aside className="live-rail" aria-label={t('nw.liveNow')}>
      <StatusCards ids={ids} servers={data} />
    </aside>
  );
}
