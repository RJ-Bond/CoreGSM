import { useEffect, useState } from 'react';
import { api } from '../../api';
import { t } from '../../i18n';
import { Section, Switch, toast } from '../../ui';

interface Quiet {
  from: number;
  to: number;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const label = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** «Тихие часы»: the private messages of the bot wait for the morning and arrive as one card (security notices do not wait) */
export function QuietHoursCard() {
  const [q, setQ] = useState<Quiet | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<Quiet>('/me/dm-quiet').then((r) => { if (alive) setQ(r); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const save = async (next: Quiet) => {
    setBusy(true);
    try {
      setQ(await api<Quiet>('/me/dm-quiet', 'PUT', next));
      toast(t('pf.quiet.saved'));
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  if (!q) return null;
  const on = q.from >= 0 && q.to >= 0;
  return (
    <Section title={t('pf.quiet.title')} description={t('pf.quiet.desc')}>
      <label htmlFor="qh-on" className="flex items-center gap-3 font-bold">
        <Switch id="qh-on" checked={on} onChange={(v) => void save(v ? { from: 23, to: 8 } : { from: -1, to: -1 })} /> {t('pf.quiet.on')}
      </label>
      {on && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="qh-from" className="label">{t('pf.quiet.from')}</label>
            <select id="qh-from" className="input" value={q.from} disabled={busy} onChange={(e) => void save({ ...q, from: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{label(h)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="qh-to" className="label">{t('pf.quiet.to')}</label>
            <select id="qh-to" className="input" value={q.to} disabled={busy} onChange={(e) => void save({ ...q, to: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{label(h)}</option>)}
            </select>
          </div>
        </div>
      )}
    </Section>
  );
}
