/**
 * Settings → Обновления и копии: the panel's setup as a JSON file (servers, Discord messages, alerts, appearance,
 * maintenance, restarts, roles and counters, without secrets) and its import into this or another panel.
 */
import { useRef, useState } from 'react';
import { api } from '../api';
import { confirmDialog } from '../confirm';
import { downloadFile } from '../pages/Backups';
import { Button, ErrorLine, Section, toast, errText } from '../ui';

interface Summary { dry: boolean; serversAdded: number; serversUpdated: number; bindings: number; maintenance: number; restarts: number; autoroles: number; counters: number; settings: number }

export function summaryText(s: Summary): string {
  const parts = [
    s.serversAdded && `новых серверов: ${s.serversAdded}`,
    s.serversUpdated && `обновится серверов: ${s.serversUpdated}`,
    s.bindings && `сообщений Discord: ${s.bindings}`,
    s.maintenance && `окон обслуживания: ${s.maintenance}`,
    s.restarts && `расписаний перезапуска: ${s.restarts}`,
    s.autoroles && `авторолей: ${s.autoroles}`,
    s.counters && `счётчиков: ${s.counters}`,
    s.settings && `настроек: ${s.settings}`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'ничего не изменится: всё уже так';
}

export default function ConfigTransfer() {
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
      return setError('Это не файл настроек CoreGSM или он повреждён');
    }
    setBusy('import');
    try {
      const preview = await api<Summary>('/config/import?dry=1', 'POST', data);
      const ok = await confirmDialog({ title: 'Импортировать настройки?', text: `Из файла «${f.name}»: ${summaryText(preview)}. Серверы с той же игрой, адресом и портом обновятся, остальные добавятся.`, confirmLabel: 'Импортировать' });
      if (!ok) return;
      const done = await api<Summary>('/config/import', 'POST', data);
      toast(`Импортировано: ${summaryText(done)}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
      if (file.current) file.current.value = '';
    }
  };

  return (
    <Section
      title="Перенос настроек"
      description="Файл с настройкой панели: серверы, сообщения в Discord, оповещения и итоги недели, оформление, повторяющиеся окна обслуживания, перезапуски, автороли и счётчики. Без игроков, истории и секретов (токен бота и пароли вводятся заново). Удобно, чтобы поднять вторую панель или перенести её на другой сервер."
    >
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="btn-soft" loading={busy === 'export'} onClick={() => void exportNow()}>Скачать файл настроек</Button>
        <Button type="button" className="btn-soft" loading={busy === 'import'} onClick={() => file.current?.click()}>Импортировать из файла…</Button>
        <input ref={file} type="file" accept="application/json,.json" className="sr-only" aria-hidden tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); }} />
      </div>
      <ErrorLine text={error} />
    </Section>
  );
}
