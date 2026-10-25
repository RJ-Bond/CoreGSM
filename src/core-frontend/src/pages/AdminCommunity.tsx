/** Admin → Сообщество: seasons (and the hall of fame they make), reviews of the servers, the screenshot gallery. */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';
import { confirmDialog, promptDialog } from '../confirm';
import { AdminPage, Button, Empty, ErrorLine, Field, IconEdit, IconEye, IconEyeOff, IconTrash, IconTrophy, PageHead, Section, ago, fmtDate, toast, num, SkeletonRows } from '../ui';
import type { Seasons } from './Community';
import { useAuth } from '../auth';
import { Stars, type Review } from '../components/server/Reviews';
import { Lightbox, type Shot } from './Gallery';
import '../styles/gallery.css';

export const COMMUNITY_TABS = [
  { id: 'seasons', get label() { return t('adm.com.seasons'); }, admin: true },
  { id: 'reviews', get label() { return t('adm.com.reviews'); }, admin: false },
  { id: 'gallery', get label() { return t('adm.com.gallery'); }, admin: false },
  { id: 'reports', get label() { return t('adm.com.reports'); }, admin: false },
  { id: 'comments', get label() { return t('adm.com.comments'); }, admin: false },
] as const;

export default function AdminCommunity({ sub = '' }: { sub?: string }) {
  useI18n();
  const { me } = useAuth();
  const tabs = COMMUNITY_TABS.filter((tab) => !tab.admin || me?.role === 'admin');
  const tab = tabs.find((tab) => tab.id === sub.split('/')[0])?.id ?? tabs[0].id;
  return (
    <AdminPage head={<PageHead icon={<IconTrophy />} title={t('adm.s.community')} subtitle={t('adm.com.subtitle')} />}>
      {tabs.length > 1 && (
        <nav className="seg" aria-label={t('adm.com.nav')}>
          {tabs.map((x) => <a key={x.id} href={`/admin/community/${x.id}`} className="seg-item" aria-current={tab === x.id ? 'page' : undefined}>{x.label}</a>)}
        </nav>
      )}
      {tab === 'seasons' && <SeasonsAdmin />}
      {tab === 'reviews' && <ReviewsAdmin />}
      {tab === 'gallery' && <GalleryAdmin />}
      {tab === 'reports' && <ReportsAdmin />}
      {tab === 'comments' && <CommentsAdmin />}
    </AdminPage>
  );
}

const toLocalInput = (ts: number) => {
  const d = new Date(ts - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

function SeasonsAdmin() {
  useI18n();
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
    if (s?.current && !(await confirmDialog({ title: t('adm.com.endQ', { name: s.current.name }), text: t('adm.com.endText'), confirmLabel: t('adm.com.startNew') }))) return;
    setBusy(true);
    await api<Seasons>('/seasons', 'POST', { name: name.trim() || t('adm.com.seasonN', { n: count + 1 }), startsAt: Number.isFinite(at) ? at : undefined })
      .then((v) => { setS(v); setName(''); setError(''); toast(t('adm.com.started')); })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };
  const rename = async (id: number, old: string) => {
    const v = await promptDialog({ title: t('adm.com.seasonName'), label: t('adm.com.name'), value: old, confirmLabel: t('adm.com.save') });
    if (!v || v.trim() === old) return;
    await api<Seasons>(`/seasons/${id}`, 'PUT', { name: v.trim() }).then(setS).catch((err: Error) => setError(err.message));
  };
  const remove = async (id: number, n: string, current: boolean) => {
    if (!(await confirmDialog({ title: t('adm.com.delQ', { name: n }), text: current ? t('adm.com.delCurrent') : t('adm.com.delPast'), confirmLabel: t('adm.srv.delete'), danger: true }))) return;
    await api<Seasons>(`/seasons/${id}`, 'DELETE').then(setS).catch((err: Error) => setError(err.message));
  };

  const rows = s ? [...(s.current ? [{ ...s.current, endsAt: null as number | null, podium: s.current.top.slice(0, 3), isCurrent: true }] : []), ...s.past.map((p) => ({ ...p, isCurrent: false }))] : [];
  return (
    <>
      <Section title={t('adm.com.newSeason')} description={t('adm.com.newSeasonText')}>
        <form onSubmit={create} className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1"><Field label={t('adm.com.name')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t('adm.com.seasonN', { n: count + 1 })} /></Field></div>
          <div className="min-w-48"><Field label={t('adm.com.start')}><input className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></Field></div>
          <Button loading={busy}>{t('adm.com.startBtn')}</Button>
        </form>
        <ErrorLine text={error} />
      </Section>

      <Section title={t('adm.com.seasons')} description={!s ? undefined : rows.length ? t('adm.com.count', { n: rows.length }) : t('adm.com.none')}>
        {!s && !error && <SkeletonRows n={2} />}
        {rows.length > 1 && <SeasonLine rows={rows} />}
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-extrabold">{r.name}{r.isCurrent && <span className="pill pill-ok">{t('adm.com.running')}</span>}</span>
                <span className="block text-sm font-semibold text-mute">
                  {fmtDate(r.startsAt)}{r.endsAt ? ` – ${fmtDate(r.endsAt)}` : ` – ${t('adm.com.now')}`}
                  {r.podium.length > 0 && ` · ${r.isCurrent ? t('adm.com.leads') : t('adm.com.champion')} ${r.podium[0].name} (${t('adm.com.hours', { n: num(r.podium[0].hours) })})`}
                </span>
              </span>
              <button type="button" className="row-act" aria-label={t('adm.com.rename')} title={t('adm.com.rename')} onClick={() => void rename(r.id, r.name)}><IconEdit /></button>
              <button type="button" className="row-act row-act-danger" aria-label={t('adm.srv.delete')} title={t('adm.srv.delete')} onClick={() => void remove(r.id, r.name, r.isCurrent)}><IconTrash /></button>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/** the seasons on one line, the width of a piece = how long the season lasted (oldest at the left) */
function SeasonLine({ rows }: { rows: { id: number; name: string; startsAt: number; endsAt: number | null; isCurrent: boolean }[] }) {
  const list = [...rows].sort((a, b) => a.startsAt - b.startsAt);
  const now = Date.now();
  const span = (r: (typeof list)[number]) => Math.max(86_400_000, (r.endsAt ?? now) - r.startsAt);
  return (
    <ol className="se-line" aria-label="Сезоны по порядку">
      {list.map((r) => (
        <li key={r.id} className={r.isCurrent ? 'is-now' : ''} style={{ flexGrow: span(r) }} title={`${r.name}: ${fmtDate(r.startsAt)}${r.endsAt ? ` – ${fmtDate(r.endsAt)}` : ' – сейчас'}`}>
          <span className="truncate">{r.name}</span>
        </li>
      ))}
    </ol>
  );
}

function ReviewsAdmin() {
  useI18n();
  const [list, setList] = useState<(Review & { serverId: number; serverName: string })[] | null>(null);
  const [error, setError] = useState('');
  const load = () => api<(Review & { serverId: number; serverName: string })[]>('/reviews').then(setList).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const hide = (id: number, hidden: boolean) => api(`/reviews/${id}`, 'PATCH', { hidden }).then(() => { toast(hidden ? t('adm.com.revHidden') : t('adm.com.revShown')); void load(); }).catch((e: Error) => setError(e.message));
  const del = async (id: number) => {
    if (!(await confirmDialog({ title: t('adm.com.revDelQ'), text: t('adm.com.revDelText'), confirmLabel: t('adm.srv.delete'), danger: true }))) return;
    await api(`/reviews/${id}`, 'DELETE').then(load).catch((e: Error) => setError(e.message));
  };
  return (
    <Section title={t('adm.com.revTitle')} description={t('adm.com.revDesc')}>
      <ErrorLine text={error} />
      {list === null ? <div className="skeleton h-24 rounded-2xl" /> : list.length === 0 ? <p className="text-sm font-semibold text-mute">{t('adm.com.revNone')}</p> : (
        <ul className="grid gap-2">
          {list.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-start gap-3 rounded-2xl bg-soft px-3 py-2.5 ${r.hidden ? 'opacity-60' : ''}`}>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-extrabold">{r.author}</span>
                  <Stars value={r.stars} />
                  <a href={`/servers/${r.serverId}`} className="text-sm font-bold text-link hover:underline">{r.serverName}</a>
                  <span className="text-xs font-bold text-mute">{ago(r.updatedAt)}</span>
                  {r.hidden && <span className="pill pill-mute">{t('adm.com.hidden')}</span>}
                </span>
                {r.text && <span className="mt-1 block whitespace-pre-line text-sm font-semibold">{r.text}</span>}
              </span>
              <button type="button" className="row-act" aria-label={r.hidden ? t('adm.com.show') : t('adm.com.hide')} title={r.hidden ? t('adm.com.show') : t('adm.com.hide')} onClick={() => void hide(r.id, !r.hidden)}>{r.hidden ? <IconEye /> : <IconEyeOff />}</button>
              <button type="button" className="row-act row-act-danger" aria-label={t('adm.srv.delete')} title={t('adm.srv.delete')} onClick={() => void del(r.id)}><IconTrash /></button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const REASON_LABEL: Record<string, string> = { cheating: 'Читы', abuse: 'Оскорбления', griefing: 'Грифинг', other: 'Другое' };
interface ReportRow { id: number; nick: string; reason: string; text: string; reporter: string; serverId: number | null; serverName: string | null; status: string; createdAt: number; handledBy: string | null; handledAt: number | null; note: string; others: number }

/** the queue of reports on players: the oldest first; a closed one tells who handled it */
function ReportsAdmin() {
  const [closed, setClosed] = useState(false);
  const [list, setList] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const load = () => api<ReportRow[]>(`/reports?status=${closed ? 'closed' : 'open'}`).then((l) => { setList(l); setError(''); }).catch((e: Error) => setError(e.message));
  useEffect(() => { setList(null); void load(); }, [closed]);
  const close = (id: number, status: 'resolved' | 'dismissed') =>
    api(`/reports/${id}`, 'PATCH', { status, note: (notes[id] ?? '').trim() })
      .then(() => { toast(status === 'resolved' ? 'Жалоба закрыта: меры приняты' : 'Жалоба отклонена'); void load(); })
      .catch((e: Error) => setError(e.message));
  return (
    <Section
      title="Жалобы на игроков"
      description={closed ? 'Рассмотренные жалобы, новые сверху' : list ? (list.length ? `Ждут решения: ${list.length}. Старые сверху` : 'Новых жалоб нет') : undefined}
      actions={<div className="seg" role="group" aria-label="Какие жалобы"><button type="button" className="seg-item" aria-current={!closed ? "true" : undefined} onClick={() => setClosed(false)}>Открытые</button><button type="button" className="seg-item" aria-current={closed ? "true" : undefined} onClick={() => setClosed(true)}>Рассмотренные</button></div>}
    >
      <ErrorLine text={error} />
      {list === null ? <div className="skeleton h-24 rounded-2xl" /> : list.length === 0 ? <p className="text-sm font-semibold text-mute">{closed ? 'Пока ничего не рассматривали.' : 'Очередь пуста.'}</p> : (
        <ul className="grid gap-2.5">
          {list.map((r) => (
            <li key={r.id} className="rounded-2xl bg-soft px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <a href={`/player/${encodeURIComponent(r.nick)}`} className="font-extrabold hover:text-link">{r.nick}</a>
                <span className="pill pill-warn">{REASON_LABEL[r.reason] ?? r.reason}</span>
                {r.others > 0 && <span className="pill pill-bad" title="Других открытых жалоб на этого игрока">ещё жалоб: {r.others}</span>}
                <span className="ml-auto text-xs font-bold text-mute">{r.reporter} · {ago(r.createdAt)}</span>
              </div>
              {r.text && <p className="mt-1.5 whitespace-pre-line text-sm font-semibold">{r.text}</p>}
              {r.serverName && <p className="mt-1 text-xs font-bold text-mute">Сервер: <a href={`/servers/${r.serverId}`} className="hover:text-link">{r.serverName}</a></p>}
              {r.status === 'open' ? (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <input className="input min-w-48 flex-1" maxLength={300} placeholder="Комментарий для автора жалобы (необязательно)" aria-label="Комментарий" value={notes[r.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
                  <button type="button" className="btn btn-success btn-sm" onClick={() => void close(r.id, 'resolved')}>Меры приняты</button>
                  <button type="button" className="btn btn-soft btn-sm" onClick={() => void close(r.id, 'dismissed')}>Отклонить</button>
                </div>
              ) : (
                <p className="mt-2 text-sm font-bold text-mute">{r.status === 'resolved' ? '✅ Меры приняты' : 'ℹ️ Отклонена'} · {r.handledBy}{r.handledAt ? `, ${ago(r.handledAt)}` : ''}{r.note ? ` · ${r.note}` : ''}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

interface QueueRow { id: number; newsId: number; title: string; author: string; text: string; status: string; hideReason: string; createdAt: number; flags: number }

/** complained-about and hidden comments under the news; the switch of the comments for the whole site */
function CommentsAdmin() {
  const { me } = useAuth();
  const canSwitch = me?.role === 'admin' || !!me?.perms?.includes('news');
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const load = () => api<QueueRow[]>('/news/comments/queue').then((l) => { setRows(l); setPicked((p) => p.filter((id) => l.some((r) => r.id === id))); setError(''); }).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    if (canSwitch) api<{ enabled: boolean }>('/news/comments/settings').then((s) => setOn(s.enabled)).catch(() => undefined);
  }, []);
  const flip = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const run = (ids: number[], action: 'approve' | 'hide' | 'delete', reason?: string) =>
    api('/news/comments/bulk', 'POST', { ids, action, ...(reason ? { reason } : {}) }).then(() => { toast('Готово'); void load(); }).catch((e: Error) => setError(e.message));
  const hideMany = async (ids: number[]) => {
    const reason = await promptDialog({ title: 'Скрыть комментарии', label: 'Причина (её увидит автор)', confirmLabel: 'Скрыть', placeholder: 'Например: оскорбления' });
    if (reason !== null) void run(ids, 'hide', reason);
  };
  const delMany = async (ids: number[]) => {
    if (await confirmDialog({ title: `Удалить комментариев: ${ids.length}?`, text: 'Это нельзя отменить.', confirmLabel: 'Удалить', danger: true })) void run(ids, 'delete');
  };
  const switchSite = (v: boolean) => api<{ enabled: boolean }>('/news/comments/settings', 'PUT', { enabled: v }).then((s) => { setOn(s.enabled); toast(s.enabled ? 'Комментарии включены' : 'Комментарии выключены'); }).catch((e: Error) => setError(e.message));
  return (
    <Section
      title="Комментарии к новостям"
      description={rows ? (rows.length ? `В очереди: ${rows.length}. Сначала те, на кого пожаловались` : 'Жалоб и скрытых комментариев нет') : undefined}
      actions={canSwitch && on !== null ? <label className="flex cursor-pointer items-center gap-2 font-bold"><input type="checkbox" className="h-4 w-4 accent-brand" checked={on} onChange={(e) => void switchSite(e.target.checked)} />Комментарии включены</label> : undefined}
    >
      <ErrorLine text={error} />
      {picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-soft px-3 py-2">
          <b>Выбрано: {picked.length}</b>
          <button type="button" className="btn btn-success btn-sm" onClick={() => void run(picked, 'approve')}>Оставить</button>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => void hideMany(picked)}>Скрыть</button>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => void delMany(picked)}>Удалить</button>
        </div>
      )}
      {rows === null ? <div className="skeleton h-24 rounded-2xl" /> : rows.length === 0 ? <p className="text-sm font-semibold text-mute">Очередь пуста.</p> : (
        <ul className="grid gap-2.5">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl bg-soft px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-brand" checked={picked.includes(r.id)} onChange={() => flip(r.id)} aria-label={`Выбрать комментарий ${r.author}`} />
                <b>{r.author}</b>
                {r.status === 'hidden' ? <span className="pill pill-mute">скрыт{r.hideReason ? `: ${r.hideReason}` : ''}</span> : <span className="pill pill-bad">жалоб: {r.flags}</span>}
                <a href={`/news/${r.newsId}#c-${r.id}`} className="min-w-0 truncate text-sm font-bold text-mute hover:text-link">{r.title}</a>
                <span className="ml-auto text-xs font-bold text-mute">{ago(r.createdAt)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-line wrap-break-word text-sm font-semibold">{r.text}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="btn btn-success btn-xs" onClick={() => void run([r.id], 'approve')}>{r.status === 'hidden' ? 'Показать' : 'Оставить'}</button>
                {r.status !== 'hidden' && <button type="button" className="btn btn-soft btn-xs" onClick={() => void hideMany([r.id])}>Скрыть</button>}
                <button type="button" className="btn btn-danger btn-xs" onClick={() => void delMany([r.id])}>Удалить</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function GalleryAdmin() {
  useI18n();
  const [list, setList] = useState<Shot[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const load = () => api<Shot[]>('/gallery/queue').then(setList).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const patch = (id: number, body: { status?: Shot['status']; featured?: boolean }, done: string) =>
    api(`/gallery/${id}`, 'PATCH', body).then(() => { toast(done); void load(); }).catch((e: Error) => setError(e.message));
  const del = async (id: number) => {
    if (!(await confirmDialog({ title: t('adm.com.shotDelQ'), text: t('adm.com.shotDelText'), confirmLabel: t('adm.srv.delete'), danger: true }))) return;
    await api(`/gallery/${id}`, 'DELETE').then(load).catch((e: Error) => setError(e.message));
  };
  const pendingList = list?.filter((s) => s.status === 'pending') ?? [];
  const waiting = pendingList.length;
  const head = pendingList[0];
  const [skipped, setSkipped] = useState<number[]>([]);
  const next = pendingList.find((x) => !skipped.includes(x.id)) ?? head;
  // A — publish, X — reject, → — later (not while typing)
  useEffect(() => {
    if (!next) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]') || open !== null) return;
      const k = e.key.toLowerCase();
      if (k === 'a' || k === 'ф') void patch(next.id, { status: 'approved' }, t('adm.com.published'));
      else if (k === 'x' || k === 'ч') void patch(next.id, { status: 'rejected' }, t('adm.com.rejected'));
      else if (e.key === 'ArrowRight') setSkipped((l) => [...l, next.id]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <Section title={t('adm.com.gallery')} description={waiting ? t('adm.com.waiting', { n: waiting }) : t('adm.com.noWaiting')}>
      <ErrorLine text={error} />
      {next && (
        <div className="mq">
          <img src={next.thumb} alt="" className="mq-img" />
          <div className="mq-body">
            <p className="text-xs font-extrabold uppercase tracking-wide text-mute">На проверке · {waiting}</p>
            <p className="font-extrabold">{next.caption || t('adm.com.noCaption')}</p>
            <p className="text-sm font-semibold text-mute">{[next.author, next.serverName, ago(next.createdAt)].filter(Boolean).join(' · ')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn btn-success btn-sm" onClick={() => void patch(next.id, { status: 'approved' }, t('adm.com.published'))}>Опубликовать <kbd>A</kbd></button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => void patch(next.id, { status: 'rejected' }, t('adm.com.rejected'))}>Отклонить <kbd>X</kbd></button>
              {waiting > 1 && <button type="button" className="btn btn-soft btn-sm" onClick={() => setSkipped((l) => [...l, next.id])}>Позже <kbd>→</kbd></button>}
            </div>
          </div>
        </div>
      )}
      {list === null ? <div className="skeleton h-40 rounded-2xl" /> : list.length === 0 ? <Empty title={t('adm.com.shotsNone')} text={t('adm.com.shotsNoneText')}><a href="/gallery" className="btn btn-soft mt-2">{t('adm.com.openGallery')}</a></Empty> : (
        <ul className="ga-grid">
          {list.map((s, i) => (
            <li key={s.id} className={`ga-card is-${s.status}`}>
              <button type="button" className="ga-img" onClick={() => setOpen(i)} aria-label={t('adm.open')}><img src={s.thumb} alt="" loading="lazy" /></button>
              <div className="ga-meta">
                <span className="block truncate font-extrabold">{s.caption || t('adm.com.noCaption')}</span>
                <span className="block truncate text-xs font-bold text-mute">{[s.author, s.serverName, ago(s.createdAt)].filter(Boolean).join(' · ')}</span>
              </div>
              <div className="ga-acts">
                {s.status !== 'approved' && <button type="button" className="btn btn-success btn-xs" onClick={() => void patch(s.id, { status: 'approved' }, t('adm.com.published'))}>{t('adm.com.approve')}</button>}
                {s.status === 'pending' && <button type="button" className="btn btn-soft btn-xs" onClick={() => void patch(s.id, { status: 'rejected' }, t('adm.com.rejected'))}>{t('adm.com.reject')}</button>}
                {s.status === 'approved' && <button type="button" className={`btn btn-xs ${s.featured ? 'btn-warn' : 'btn-soft'}`} onClick={() => void patch(s.id, { featured: !s.featured }, s.featured ? t('adm.com.unstarred') : t('adm.com.starred'))}>{s.featured ? t('adm.com.inBest') : t('adm.com.toBest')}</button>}
                {s.status === 'approved' && <button type="button" className="btn btn-soft btn-xs" onClick={() => void patch(s.id, { status: 'rejected' }, t('adm.com.unpublished'))}>{t('adm.com.take')}</button>}
                <button type="button" className="row-act row-act-danger" aria-label={t('adm.srv.delete')} title={t('adm.srv.delete')} onClick={() => void del(s.id)}><IconTrash /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open !== null && list && <Lightbox list={list} index={open} onClose={() => setOpen(null)} onIndex={setOpen} />}
    </Section>
  );
}
