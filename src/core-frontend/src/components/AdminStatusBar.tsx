import { useState } from 'react';
import { api, type Server } from '../api';
import { t, useI18n } from '../i18n';
import { Button, ago, toast } from '../ui';
import { useApiQuery } from '../ui/query';

/** The strip at the top of the admin area: is the polling alive, when was the last poll, poll everything now */
export default function AdminStatusBar() {
  useI18n();
  const [busy, setBusy] = useState(false);
  const { data: servers, refetch } = useApiQuery<Server[]>('/servers', { pollMs: 20_000 });

  if (!servers || servers.length === 0) return null;
  const last = servers.reduce((m, s) => Math.max(m, s.updatedAt ?? 0), 0);
  const stale = last > 0 && Date.now() - last > 5 * 60_000;
  const down = servers.filter((s) => !s.online && s.hasStatus && !s.maintenance).length;
  const tone = stale ? 'warn' : down > 0 ? 'bad' : 'ok';
  const text = stale ? t('d2.asb.stale') : down > 0 ? t('d2.asb.down', { n: down }) : t('d2.asb.ok');

  const pollAll = async () => {
    setBusy(true);
    await Promise.allSettled(servers.map((s) => api(`/servers/${s.id}/refresh`, 'POST')));
    toast(t('d2.asb.t.polled'));
    await refetch();
    setBusy(false);
  };

  return (
    <div className="adm-status" role="status">
      <span className={`adm-status-dot is-${tone}`} aria-hidden />
      <span className="font-extrabold">{text}</span>
      {last > 0 && <span className="text-mute" title={t('d2.asb.lastTitle')}>· {ago(last)}</span>}
      <Button type="button" size="sm" variant="soft" className="ml-auto" loading={busy} onClick={() => void pollAll()}>{t('d2.asb.pollAll')}</Button>
    </div>
  );
}
