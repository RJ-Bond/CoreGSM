/**
 * Settings → Обновления и копии: the panel's setup as a JSON file (servers, Discord messages, alerts, appearance,
 * maintenance, restarts, roles and counters, without secrets) and its import into this or another panel.
 */
import { useRef, useState } from 'react';
import { api } from '../api';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import { downloadFile } from '../pages/Backups';
import { Button, ErrorLine, Section, toast, errText } from '../ui';

interface Summary { dry: boolean; serversAdded: number; serversUpdated: number; bindings: number; maintenance: number; restarts: number; autoroles: number; counters: number; settings: number }

export function summaryText(s: Summary): string {
  const parts = [
    s.serversAdded && t('d2.ct.added', { n: s.serversAdded }),
    s.serversUpdated && t('d2.ct.updated', { n: s.serversUpdated }),
    s.bindings && t('d2.ct.bindings', { n: s.bindings }),
    s.maintenance && t('d2.ct.maint', { n: s.maintenance }),
    s.restarts && t('d2.ct.restarts', { n: s.restarts }),
    s.autoroles && t('d2.ct.autoroles', { n: s.autoroles }),
    s.counters && t('d2.ct.counters', { n: s.counters }),
    s.settings && t('d2.ct.settings', { n: s.settings }),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : t('d2.ct.nothing');
}

export default function ConfigTransfer() {
  useI18n();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const exportNow = async () => {
    setBusy('export');
    await downloadFile('/config/export', 'coregsm-config.json').catch((e: Error) => setError(e.message)).finally(() => setBusy(''));
  };
  const importFile = async (f: File) => {
    setError('');
    let data: unknown;
    try {
      data = JSON.parse(await f.text());
    } catch {
      return setError(t('d2.ct.e.bad'));
    }
    setBusy('import');
    try {
      const preview = await api<Summary>('/config/import?dry=1', 'POST', data);
      const ok = await confirmDialog({ title: t('d2.ct.c.title'), text: t('d2.ct.c.text', { name: f.name, sum: summaryText(preview) }), confirmLabel: t('d2.ct.c.confirm') });
      if (!ok) return;
      const done = await api<Summary>('/config/import', 'POST', data);
      toast(t('d2.ct.t.done', { sum: summaryText(done) }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
      if (file.current) file.current.value = '';
    }
  };

  return (
    <Section
      title={t('d2.ct.title')}
      description={t('d2.ct.desc')}
    >
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="btn-soft" loading={busy === 'export'} onClick={() => void exportNow()}>{t('d2.ct.export')}</Button>
        <Button type="button" className="btn-soft" loading={busy === 'import'} onClick={() => file.current?.click()}>{t('d2.ct.import')}</Button>
        <input ref={file} type="file" accept="application/json,.json" className="sr-only" aria-hidden tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); }} />
      </div>
      <ErrorLine text={error} />
    </Section>
  );
}
