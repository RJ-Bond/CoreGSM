/** Admin → Сообщество: seasons (and the hall of fame they make), reviews of the servers, the screenshot gallery. */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { confirmDialog, promptDialog } from '../confirm';
import { AdminPage, Button, ErrorLine, Field, IconEdit, IconTrash, IconTrophy, PageHead, Section, fmtDate, plural, toast } from '../ui';
import type { Seasons } from './Community';

export const COMMUNITY_TABS = [
  { id: 'seasons', label: 'Сезоны' },
] as const;

export default function AdminCommunity({ sub = '' }: { sub?: string }) {
  const tab = COMMUNITY_TABS.find((t) => t.id === sub.split('/')[0])?.id ?? 'seasons';
  return (
    <AdminPage head={<PageHead icon={<IconTrophy />} title="Сообщество" subtitle="Сезоны и зал славы, отзывы о серверах, галерея скриншотов" />}>
      {COMMUNITY_TABS.length > 1 && (
        <nav className="seg" aria-label="Разделы сообщества">
          {COMMUNITY_TABS.map((t) => <a key={t.id} href={`/admin/community/${t.id}`} className="seg-item" aria-current={tab === t.id ? 'page' : undefined}>{t.label}</a>)}
        </nav>
      )}
      {tab === 'seasons' && <SeasonsAdmin />}
    </AdminPage>
  );
}

const toLocalInput = (ts: number) => {
  const d = new Date(ts - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

function SeasonsAdmin() {
  const [s, setS] = useState<Seasons | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [start, setStart] = useState(() => toLocalInput(Date.now()));
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Seasons>('/seasons').then(setS).catch((e: Error) => setError(e.message)); }, []);

  const count = (s?.past.length ?? 0) + (s?.current ? 1 : 0);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    const at = new Date(start).getTime();
    if (s?.current && !(await confirmDialog({ title: `Завершить «${s.current.name}»?`, text: 'Текущий сезон закончится, его тройка лучших попадёт в зал славы, а таблица нового сезона начнётся с нуля.', confirmLabel: 'Начать новый сезон' }))) return;
    setBusy(true);
    await api<Seasons>('/seasons', 'POST', { name: name.trim() || `Сезон ${count + 1}`, startsAt: Number.isFinite(at) ? at : undefined })
      .then((v) => { setS(v); setName(''); setError(''); toast('Новый сезон начался'); })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };
  const rename = async (id: number, old: string) => {
    const v = await promptDialog({ title: 'Название сезона', label: 'Название', value: old, confirmLabel: 'Сохранить' });
    if (!v || v.trim() === old) return;
    await api<Seasons>(`/seasons/${id}`, 'PUT', { name: v.trim() }).then(setS).catch((err: Error) => setError(err.message));
  };
  const remove = async (id: number, n: string, current: boolean) => {
    if (!(await confirmDialog({ title: `Удалить «${n}»?`, text: current ? 'Предыдущий сезон снова станет текущим.' : 'Сезон пропадёт из зала славы. Игровая статистика не удаляется.', confirmLabel: 'Удалить', danger: true }))) return;
    await api<Seasons>(`/seasons/${id}`, 'DELETE').then(setS).catch((err: Error) => setError(err.message));
  };

  const rows = s ? [...(s.current ? [{ ...s.current, endsAt: null as number | null, podium: s.current.top.slice(0, 3), isCurrent: true }] : []), ...s.past.map((p) => ({ ...p, isCurrent: false }))] : [];
  return (
    <>
      <Section title="Новый сезон" description="Начните сезон, например, в день вайпа. Таблица сезона на странице «Сообщество» считает часы с его начала, а когда начнётся следующий, тройка лучших попадёт в зал славы и получит достижения.">
        <form onSubmit={create} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1"><Field label="Название"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={`Сезон ${count + 1}`} /></Field></div>
          <div className="min-w-[12rem]"><Field label="Начало"><input className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></Field></div>
          <Button loading={busy}>Начать сезон</Button>
        </form>
        <ErrorLine text={error} />
      </Section>

      <Section title="Сезоны" description={rows.length ? `${rows.length} ${plural(rows.length, ['сезон', 'сезона', 'сезонов'])}` : 'Сезонов пока нет'}>
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-extrabold">{r.name}{r.isCurrent && <span className="pill pill-ok">идёт</span>}</span>
                <span className="block text-sm font-semibold text-mute">
                  {fmtDate(r.startsAt)}{r.endsAt ? ` – ${fmtDate(r.endsAt)}` : ' – сейчас'}
                  {r.podium.length > 0 && ` · ${r.isCurrent ? 'лидирует' : 'чемпион'} ${r.podium[0].name} (${r.podium[0].hours} ч)`}
                </span>
              </span>
              <button type="button" className="row-act" aria-label="Переименовать" title="Переименовать" onClick={() => void rename(r.id, r.name)}><IconEdit /></button>
              <button type="button" className="row-act row-act-danger" aria-label="Удалить" title="Удалить" onClick={() => void remove(r.id, r.name, r.isCurrent)}><IconTrash /></button>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
