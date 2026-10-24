import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { JournalArt } from '../components/Illustrations';
import { AdminPage, Empty, ErrorLine, IconJournal, LoadError, PageHead, fmtDateTime, fmtTime, usePoll, SkeletonRows } from '../ui';

interface Row { id: number; ts: number; actor: string; action: string; detail: string }

type Kind = 'add' | 'edit' | 'del' | 'sec';

/** a rough class of an entry by the words of its action: creating, changing, removing, signing in / passwords */
function kindOf(action: string): Kind {
  const a = action.toLowerCase();
  if (/удал|снят|отклон|delete|remove/.test(a)) return 'del';
  if (/созд|добав|одобр|привяз|create|add/.test(a)) return 'add';
  if (/вход|парол|сесс|токен|login|password|session|token/.test(a)) return 'sec';
  return 'edit';
}

const ICON: Record<Kind, ReactNode> = {
  add: <path d="M12 5v14M5 12h14" />,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  del: <><path d="M3 6h18" /><path d="M8 6V4h8v2M19 6l-1 14H6L5 6" /></>,
  sec: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
};

const STEP = 200;
const MAX = 2000;

const dayLabel = (ts: number) => {
  const d = new Date(ts);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86_400_000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });
};

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/** Who changed what and when (the last 2000 actions). */
export default function JournalPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(100);
  const limitRef = useRef(limit);
  limitRef.current = limit;
  const load = () => api<Row[]>(`/audit?limit=${limitRef.current}`).then((r) => { setRows(r); setError(''); }).catch((e: Error) => setError(e.message));
  usePoll(load, 20_000);
  useEffect(() => { void load(); }, [limit]); // eslint-disable-line react-hooks/exhaustive-deps

  const needle = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => !needle || `${r.actor} ${r.action} ${r.detail}`.toLowerCase().includes(needle));
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of shown) {
      const k = dayLabel(r.ts);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m];
  }, [shown]);

  const exportCsv = () => {
    const lines = ['время,кто,действие,подробности', ...shown.map((r) => [new Date(r.ts).toISOString(), r.actor, r.action, r.detail].map(csvCell).join(','))];
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'coregsm-journal.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const more = !!rows && rows.length >= limit && limit < MAX;

  return (
    <AdminPage
      head={(
        <PageHead
          icon={<IconJournal />}
          title="Журнал"
          subtitle="Кто и что менял в панели"
          hint="Здесь записано, кто из администраторов что и когда менял. Это помогает понять, откуда взялось изменение."
          help={<p>Хранятся последние 2000 действий. Поиск работает по имени, действию и подробностям.</p>}
        >
          <button type="button" className="btn btn-soft" onClick={exportCsv} disabled={shown.length === 0}>Скачать CSV</button>
        </PageHead>
      )}
    >
      {error && !rows ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}
      <input className="input max-w-sm" type="search" placeholder="Поиск по журналу…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по журналу" />
      {!rows && !error && <SkeletonRows n={6} h="h-12" />}
      {rows && shown.length === 0 && <Empty art={<JournalArt />} title="Записей нет" text={needle ? 'Ничего не найдено.' : 'Действия администраторов будут появляться здесь.'} />}
      {groups.map(([day, list]) => (
        <section key={day} className="space-y-2">
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-mute">{day}</h2>
          <ul className="panel divide-y divide-line overflow-hidden">
            {list.map((r) => {
              const k = kindOf(r.action);
              return (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-3">
                  <span className={`jr-ico is-${k}`} aria-hidden><Icon size={14}>{ICON[k]}</Icon></span>
                  <span className="w-14 shrink-0 text-sm font-semibold tabular-nums text-mute" title={fmtDateTime(r.ts)}>{fmtTime(r.ts)}</span>
                  <span className="font-extrabold">{r.action}</span>
                  {r.detail && <span className="min-w-0 wrap-break-word font-semibold text-mute">{r.detail}</span>}
                  <span className="ml-auto rounded-full bg-soft px-2.5 py-0.5 text-sm font-bold text-link">{r.actor}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {more && <button type="button" className="btn btn-soft" onClick={() => setLimit((l) => Math.min(MAX, l + STEP))}>Показать ещё</button>}
    </AdminPage>
  );
}
