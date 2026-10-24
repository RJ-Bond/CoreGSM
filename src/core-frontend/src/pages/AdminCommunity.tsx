/** Admin → Сообщество: seasons (and the hall of fame they make), reviews of the servers, the screenshot gallery. */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { confirmDialog, promptDialog } from '../confirm';
import { AdminPage, Button, Empty, ErrorLine, Field, IconEdit, IconEye, IconEyeOff, IconTrash, IconTrophy, PageHead, Section, ago, fmtDate, plural, toast, num, SkeletonRows } from '../ui';
import type { Seasons } from './Community';
import { useAuth } from '../auth';
import { Stars, type Review } from '../components/server/Reviews';
import { Lightbox, type Shot } from './Gallery';
import '../styles/gallery.css';

export const COMMUNITY_TABS = [
  { id: 'seasons', label: 'Сезоны', admin: true },
  { id: 'reviews', label: 'Отзывы', admin: false },
  { id: 'gallery', label: 'Галерея', admin: false },
] as const;

export default function AdminCommunity({ sub = '' }: { sub?: string }) {
  const { me } = useAuth();
  const tabs = COMMUNITY_TABS.filter((t) => !t.admin || me?.role === 'admin');
  const tab = tabs.find((t) => t.id === sub.split('/')[0])?.id ?? tabs[0].id;
  return (
    <AdminPage head={<PageHead icon={<IconTrophy />} title="Сообщество" subtitle="Сезоны и зал славы, отзывы о серверах, галерея скриншотов" />}>
      {tabs.length > 1 && (
        <nav className="seg" aria-label="Разделы сообщества">
          {tabs.map((t) => <a key={t.id} href={`/admin/community/${t.id}`} className="seg-item" aria-current={tab === t.id ? 'page' : undefined}>{t.label}</a>)}
        </nav>
      )}
      {tab === 'seasons' && <SeasonsAdmin />}
      {tab === 'reviews' && <ReviewsAdmin />}
      {tab === 'gallery' && <GalleryAdmin />}
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
          <div className="min-w-48 flex-1"><Field label="Название"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={`Сезон ${count + 1}`} /></Field></div>
          <div className="min-w-48"><Field label="Начало"><input className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></Field></div>
          <Button loading={busy}>Начать сезон</Button>
        </form>
        <ErrorLine text={error} />
      </Section>

      <Section title="Сезоны" description={!s ? undefined : rows.length ? `${rows.length} ${plural(rows.length, ['сезон', 'сезона', 'сезонов'])}` : 'Сезонов пока нет'}>
        {!s && !error && <SkeletonRows n={2} />}
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-extrabold">{r.name}{r.isCurrent && <span className="pill pill-ok">идёт</span>}</span>
                <span className="block text-sm font-semibold text-mute">
                  {fmtDate(r.startsAt)}{r.endsAt ? ` – ${fmtDate(r.endsAt)}` : ' – сейчас'}
                  {r.podium.length > 0 && ` · ${r.isCurrent ? 'лидирует' : 'чемпион'} ${r.podium[0].name} (${num(r.podium[0].hours)} ч)`}
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

function ReviewsAdmin() {
  const [list, setList] = useState<(Review & { serverId: number; serverName: string })[] | null>(null);
  const [error, setError] = useState('');
  const load = () => api<(Review & { serverId: number; serverName: string })[]>('/reviews').then(setList).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const hide = (id: number, hidden: boolean) => api(`/reviews/${id}`, 'PATCH', { hidden }).then(() => { toast(hidden ? 'Отзыв скрыт' : 'Отзыв снова виден'); void load(); }).catch((e: Error) => setError(e.message));
  const del = async (id: number) => {
    if (!(await confirmDialog({ title: 'Удалить отзыв?', text: 'Автор сможет написать новый.', confirmLabel: 'Удалить', danger: true }))) return;
    await api(`/reviews/${id}`, 'DELETE').then(load).catch((e: Error) => setError(e.message));
  };
  return (
    <Section title="Отзывы о серверах" description="Отзывы видны сразу. Скрытый отзыв не учитывается в оценке сервера, автор видит пометку «скрыт модератором».">
      <ErrorLine text={error} />
      {list === null ? <div className="skeleton h-24 rounded-2xl" /> : list.length === 0 ? <p className="text-sm font-semibold text-mute">Отзывов пока нет.</p> : (
        <ul className="grid gap-2">
          {list.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-start gap-3 rounded-2xl bg-soft px-3 py-2.5 ${r.hidden ? 'opacity-60' : ''}`}>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-extrabold">{r.author}</span>
                  <Stars value={r.stars} />
                  <a href={`/servers/${r.serverId}`} className="text-sm font-bold text-link hover:underline">{r.serverName}</a>
                  <span className="text-xs font-bold text-mute">{ago(r.updatedAt)}</span>
                  {r.hidden && <span className="pill pill-mute">скрыт</span>}
                </span>
                {r.text && <span className="mt-1 block whitespace-pre-line text-sm font-semibold">{r.text}</span>}
              </span>
              <button type="button" className="row-act" aria-label={r.hidden ? 'Показать' : 'Скрыть'} title={r.hidden ? 'Показать' : 'Скрыть'} onClick={() => void hide(r.id, !r.hidden)}>{r.hidden ? <IconEye /> : <IconEyeOff />}</button>
              <button type="button" className="row-act row-act-danger" aria-label="Удалить" title="Удалить" onClick={() => void del(r.id)}><IconTrash /></button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function GalleryAdmin() {
  const [list, setList] = useState<Shot[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const load = () => api<Shot[]>('/gallery/queue').then(setList).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const patch = (id: number, body: { status?: Shot['status']; featured?: boolean }, done: string) =>
    api(`/gallery/${id}`, 'PATCH', body).then(() => { toast(done); void load(); }).catch((e: Error) => setError(e.message));
  const del = async (id: number) => {
    if (!(await confirmDialog({ title: 'Удалить скриншот?', text: 'Картинка будет удалена насовсем.', confirmLabel: 'Удалить', danger: true }))) return;
    await api(`/gallery/${id}`, 'DELETE').then(load).catch((e: Error) => setError(e.message));
  };
  const waiting = list?.filter((s) => s.status === 'pending').length ?? 0;
  return (
    <Section title="Галерея" description={waiting ? `Ждут проверки: ${waiting}` : 'Новых скриншотов на проверке нет.'}>
      <ErrorLine text={error} />
      {list === null ? <div className="skeleton h-40 rounded-2xl" /> : list.length === 0 ? <Empty title="Скриншотов пока нет" text="Игроки загружают их на странице «Галерея»."><a href="/gallery" className="btn btn-soft mt-2">Открыть галерею</a></Empty> : (
        <ul className="ga-grid">
          {list.map((s, i) => (
            <li key={s.id} className={`ga-card is-${s.status}`}>
              <button type="button" className="ga-img" onClick={() => setOpen(i)} aria-label="Открыть"><img src={s.thumb} alt="" loading="lazy" /></button>
              <div className="ga-meta">
                <span className="block truncate font-extrabold">{s.caption || 'Без подписи'}</span>
                <span className="block truncate text-xs font-bold text-mute">{[s.author, s.serverName, ago(s.createdAt)].filter(Boolean).join(' · ')}</span>
              </div>
              <div className="ga-acts">
                {s.status !== 'approved' && <button type="button" className="btn btn-success btn-xs" onClick={() => void patch(s.id, { status: 'approved' }, 'Скриншот опубликован')}>Одобрить</button>}
                {s.status === 'pending' && <button type="button" className="btn btn-soft btn-xs" onClick={() => void patch(s.id, { status: 'rejected' }, 'Скриншот отклонён')}>Отклонить</button>}
                {s.status === 'approved' && <button type="button" className={`btn btn-xs ${s.featured ? 'btn-warn' : 'btn-soft'}`} onClick={() => void patch(s.id, { featured: !s.featured }, s.featured ? 'Звезда снята' : 'Скриншот в лучших')}>{s.featured ? '★ В лучших' : '☆ В лучшие'}</button>}
                {s.status === 'approved' && <button type="button" className="btn btn-soft btn-xs" onClick={() => void patch(s.id, { status: 'rejected' }, 'Скриншот снят с публикации')}>Снять</button>}
                <button type="button" className="row-act row-act-danger" aria-label="Удалить" title="Удалить" onClick={() => void del(s.id)}><IconTrash /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open !== null && list && <Lightbox list={list} index={open} onClose={() => setOpen(null)} onIndex={setOpen} />}
    </Section>
  );
}
