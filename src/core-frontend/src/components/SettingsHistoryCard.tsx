import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { confirmDialog } from '../confirm';
import { t, type TKey, useI18n } from '../i18n';
import { Button, ErrorLine, Section, ago, fmtDateTime, toast, errText } from '../ui';

interface Row { id: number; ts: number; actor: string | null; key: string; from: string | null; to: string | null }

/** the name of a setting in the words of the panel (the key itself when there is no name for it) */
const keyName = (key: string): string => {
  const id = `hist.key.${key}` as TKey;
  const v = t(id);
  return v === id ? key : v;
};
const valueText = (v: string | null): string => (v === null || v === '' ? t('hist.empty') : v === '1' ? t('hist.on') : v === '0' ? t('hist.off') : v);

/** «История настроек»: who changed which setting, from what to what, and a button to put it back */
export default function SettingsHistoryCard() {
  useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(() => api<Row[]>('/settings/history?limit=30').then((r) => { setRows(r); setError(''); }).catch((e) => setError(errText(e))), []);
  useEffect(() => { void load(); }, [load]);

  const revert = async (r: Row) => {
    if (!(await confirmDialog({ title: t('hist.revertQ', { name: keyName(r.key) }), text: t('hist.revertText', { value: valueText(r.from) }), confirmLabel: t('hist.revert') }))) return;
    setBusy(r.id);
    try {
      await api(`/settings/history/${r.id}/revert`, 'POST');
      toast(t('hist.reverted'));
      await load();
    } catch (e) {
      toast(errText(e), 'err');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title={t('hist.title')} description={t('hist.desc')}>
      <ErrorLine text={error} />
      {rows === null && !error && <div className="skeleton h-24 rounded-2xl" aria-busy="true" />}
      {rows && rows.length === 0 && <p className="font-semibold text-mute">{t('hist.none')}</p>}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="hist-row flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold">{keyName(r.key)}</span>
                <span className="hist-change block text-sm font-semibold text-mute">
                  <span className="hist-from">{valueText(r.from)}</span>
                  <span aria-hidden> → </span>
                  <span className="hist-to">{valueText(r.to)}</span>
                </span>
              </span>
              <span className="text-sm font-semibold text-mute" title={fmtDateTime(r.ts)}>{r.actor ?? t('hist.system')} · {ago(r.ts)}</span>
              <Button type="button" variant="soft" size="sm" loading={busy === r.id} onClick={() => void revert(r)}>{t('hist.revert')}</Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
