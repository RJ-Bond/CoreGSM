import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { t, useI18n } from '../i18n';
import { normalizeKinds, useSubscriptions, type SubKind } from '../notifications';
import { errText, toast } from '../ui';

const OUTAGE: SubKind[] = ['went_down', 'back_online'];

/** a line under the heading of the status page: «tell me when any server goes down and comes back» for all the servers of the page at once */
export default function StatusSubscribe({ servers }: { servers: { id: number }[] }) {
  useI18n();
  const { me } = useAuth();
  const subs = useSubscriptions(!!me);
  const [busy, setBusy] = useState(false);
  if (!me) return <p className="st-sub-line"><a href="/login">{t('st.sub.login')}</a></p>;
  if (subs.unavailable || subs.list === null || servers.length === 0) return null;
  const kindsOf = (id: number): SubKind[] => normalizeKinds(subs.list?.find((s) => s.serverId === id)?.kinds);
  const on = servers.every((s) => kindsOf(s.id).includes('went_down'));
  const toggle = async () => {
    setBusy(true);
    try {
      for (const s of servers) {
        const cur = kindsOf(s.id);
        const next = normalizeKinds(on ? cur.filter((k) => !OUTAGE.includes(k)) : [...cur, ...OUTAGE]);
        const r = await api<{ serverId?: number; kinds?: SubKind[] }>(`/servers/${s.id}/subscription`, 'PUT', { kinds: next });
        subs.set({ serverId: s.id, kinds: normalizeKinds(r?.kinds ?? next) });
      }
      toast(on ? t('st.sub.off') : t('st.sub.on'));
    } catch (e) {
      toast(errText(e), 'err');
    }
    setBusy(false);
  };
  return (
    <div className="st-sub-line">
      <button type="button" className={`btn ${on ? 'btn-soft' : ''} btn-sm`} aria-pressed={on} disabled={busy} onClick={() => void toggle()}>
        {on ? t('st.sub.btnOn') : t('st.sub.btn')}
      </button>
      <span>{on ? t('st.sub.hintOn', { n: servers.length }) : t('st.sub.hint')}</span>
    </div>
  );
}
