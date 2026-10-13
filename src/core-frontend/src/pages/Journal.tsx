import { useState } from 'react';
import { api } from '../api';
import { AdminPage, Empty, ErrorLine, IconJournal, LoadError, PageHead, fmtDateTime, usePoll } from '../ui';

interface Row { id: number; ts: number; actor: string; action: string; detail: string }

/** Who changed what and when (the last 2000 actions). */
export default function JournalPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const load = () => api<Row[]>('/audit?limit=300').then((r) => { setRows(r); setError(''); }).catch((e: Error) => setError(e.message));
  usePoll(load, 20_000);

  const needle = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => !needle || `${r.actor} ${r.action} ${r.detail}`.toLowerCase().includes(needle));

  return (
    <AdminPage
      head={(
        <PageHead
          icon={<IconJournal />}
          title="Журнал"
          subtitle="Кто и что менял в панели"
          hint="Здесь записано, кто из администраторов что и когда менял. Это помогает понять, откуда взялось изменение."
          help={<p>Хранятся последние 2000 действий. Поиск работает по имени, действию и подробностям.</p>}
        />
      )}
    >
      {error && !rows ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}
      <input className="input max-w-sm" type="search" placeholder="Поиск по журналу…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по журналу" />
      {rows && shown.length === 0 && <Empty title="Записей нет" text={needle ? 'Ничего не найдено.' : 'Действия администраторов будут появляться здесь.'} />}
      {shown.length > 0 && (
        <ul className="panel divide-y divide-line overflow-hidden">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-3">
              <span className="w-40 shrink-0 text-sm font-semibold tabular-nums text-mute">{fmtDateTime(r.ts)}</span>
              <span className="font-extrabold">{r.action}</span>
              {r.detail && <span className="min-w-0 break-words font-semibold text-mute">{r.detail}</span>}
              <span className="ml-auto rounded-full bg-soft px-2.5 py-0.5 text-sm font-bold text-link">{r.actor}</span>
            </li>
          ))}
        </ul>
      )}
    </AdminPage>
  );
}
