import { useEffect, useState } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';
import { fmtDateTime, Section, toast } from '../ui';

interface Storage {
  dbBytes: number | null;
  tables: { id: string; rows: number; oldest: number | null; days: number }[];
}

const NAMES = { history: 'sto.history', playerSessions: 'sto.playerSessions', accountEvents: 'sto.accountEvents', uptime: 'sto.uptime' } as const;

const mb = (n: number | null) => (n == null ? '–' : n > 1073741824 ? `${(n / 1073741824).toFixed(1)} ${t('sto.gb')}` : `${(n / 1048576).toFixed(1)} ${t('sto.mb')}`);

/** «Data storage»: how much each kind of rows takes, how long it is kept and a button to prune the old rows now */
export default function StorageCard() {
  useI18n();
  const [s, setS] = useState<Storage | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Storage>('/system/storage').then(setS).catch(() => undefined); }, []);
  if (!s) return null;
  const prune = () => {
    setBusy(true);
    api<Storage>('/system/storage/prune', 'POST').then((r) => { setS(r); toast(t('sto.done')); }).catch((e: Error) => toast(e.message)).finally(() => setBusy(false));
  };
  return (
    <Section title={t('sto.title')} description={t('sto.text', { size: mb(s.dbBytes) })}>
      <ul className="divide-y divide-line">
        {s.tables.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2.5">
            <span className="font-extrabold">{t(NAMES[r.id as keyof typeof NAMES] ?? 'sto.history')}</span>
            <span className="text-sm font-semibold text-mute">{r.oldest ? t('sto.since', { date: fmtDateTime(r.oldest) }) : t('sto.empty')} · {t('sto.keep', { n: r.days })}</span>
            <span className="ml-auto font-black tabular-nums">{r.rows.toLocaleString()}</span>
          </li>
        ))}
      </ul>
      <button className="btn btn-soft btn-sm" onClick={prune} disabled={busy}>{t('sto.prune')}</button>
    </Section>
  );
}
