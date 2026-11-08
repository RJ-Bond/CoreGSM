import { useState } from 'react';
import { api } from '../api';
import { Switch } from '../components/Switch';
import { soon } from '../components/GameNewsParts';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import { Field, errText, toast, usePoll } from '../ui';
import { EmptyState } from './GameNewsUi';

export interface ScheduleItem { id: number; serverId: number; serverName: string; time: string; days: number[]; warnSec: number; enabled: boolean; next: number | null; skipped: boolean }
interface Form { id: number | null; serverId: number; time: string; days: number[]; warnSec: number; enabled: boolean }

/** Monday first, as a person reads a week: the numbers are those of the server (0 = Sunday) */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_KEY = ['gn.rs.d0', 'gn.rs.d1', 'gn.rs.d2', 'gn.rs.d3', 'gn.rs.d4', 'gn.rs.d5', 'gn.rs.d6'] as const;
const WARNS = [300, 600, 900, 1800];

const daysText = (days: number[]): string => {
  if (days.length === 0 || days.length === 7) return t('gn.rs.everyDay');
  return WEEK.filter((d) => days.includes(d)).map((d) => t(DAY_KEY[d])).join(' · ');
};

/** Planned restarts through the plugin: «every day at 05:00». The warning in the chat is the same countdown as for a restart started by hand. */
export function SchedulePanel({ servers, onlyServer }: { servers: { id: number; name: string }[]; onlyServer: number }) {
  useI18n();
  const [items, setItems] = useState<ScheduleItem[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<{ items: ScheduleItem[] }>('/game-news/restart-schedule').then((d) => setItems(d.items)).catch(() => undefined);
  usePoll(load, 15_000);

  const blank = (): Form => ({ id: null, serverId: onlyServer, time: '05:00', days: [], warnSec: 600, enabled: true });
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok, 'ok'); await load(); } catch (e) { toast(errText(e as Error), 'err'); } finally { setBusy(false); }
  };
  const save = () => {
    if (!form) return;
    const body = { serverId: form.serverId, time: form.time, days: form.days, warnSec: form.warnSec, enabled: form.enabled };
    void run(async () => {
      if (form.id == null) await api('/game-news/restart-schedule', 'POST', body); else await api(`/game-news/restart-schedule/${form.id}`, 'PUT', body);
      setForm(null);
    }, t('gn.rs.saved'));
  };
  const toggle = (i: ScheduleItem, enabled: boolean) => run(() => api(`/game-news/restart-schedule/${i.id}`, 'PUT', { serverId: i.serverId, time: i.time, days: i.days, warnSec: i.warnSec, enabled }));
  const skip = (i: ScheduleItem) => run(() => api(`/game-news/restart-schedule/${i.id}/skip`, 'POST', { skip: !i.skipped }));
  const remove = async (i: ScheduleItem) => {
    if (!(await confirmDialog({ title: t('gn.rs.deleteTitle', { time: i.time }), danger: true, confirmLabel: t('gn.rs.delete') }))) return;
    await run(() => api(`/game-news/restart-schedule/${i.id}`, 'DELETE'));
  };

  // on a server's page only its own schedules (and those for all servers) are shown
  const list = (items ?? []).filter((i) => !onlyServer || i.serverId === 0 || i.serverId === onlyServer);

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-mute">{t('gn.rs.note')}</p>

      {items && list.length === 0 && !form && (
        <EmptyState icon="⏰" title={t('gn.rs.empty')} hint={t('gn.rs.emptyHint')} action={<button type="button" className="btn btn-sm" onClick={() => setForm(blank())}>{t('gn.rs.add')}</button>} />
      )}

      <ul className="space-y-2">
        {list.map((i) => (
          <li key={i.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line px-4 py-3 ${i.enabled ? '' : 'opacity-70'}`}>
            <span className="text-2xl font-extrabold tabular-nums">{i.time}</span>
            <div className="min-w-0 flex-1 basis-52">
              <div className="font-bold">{daysText(i.days)} · {i.serverId ? i.serverName : t('gn.rs.allServers')}</div>
              <div className="text-sm font-semibold text-mute">
                {t('gn.rs.warn', { n: i.warnSec / 60 })}
                {i.enabled && i.next && ` · ${i.skipped ? t('gn.rs.skipped') : t('gn.rs.next', { time: soon(i.next) })}`}
              </div>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {i.enabled && i.next && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void skip(i)}>{i.skipped ? t('gn.rs.unskip') : t('gn.rs.skip')}</button>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ id: i.id, serverId: i.serverId, time: i.time, days: i.days, warnSec: i.warnSec, enabled: i.enabled })}>{t('gn.rs.edit')}</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void remove(i)}>{t('gn.rs.delete')}</button>
              <Switch checked={i.enabled} disabled={busy} onChange={(v) => void toggle(i, v)} aria-label={t('gn.rs.enabled')} />
            </div>
          </li>
        ))}
      </ul>

      {form ? (
        <div className="space-y-3 rounded-xl border border-line px-4 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('gn.rs.time')}>
              <input className="input w-32" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </Field>
            {!onlyServer && (
              <Field label={t('gn.rs.server')}>
                <select className="input" value={form.serverId} onChange={(e) => setForm({ ...form, serverId: Number(e.target.value) })}>
                  <option value={0}>{t('gn.rs.allServers')}</option>
                  {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            )}
            <Field label={t('gn.rs.warnLabel')}>
              <select className="input" value={form.warnSec} onChange={(e) => setForm({ ...form, warnSec: Number(e.target.value) })}>
                {WARNS.map((w) => <option key={w} value={w}>{t('gn.rs.warn', { n: w / 60 })}</option>)}
              </select>
            </Field>
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-bold">{t('gn.rs.daysLabel')}</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('gn.rs.daysLabel')}>
              {WEEK.map((d) => (
                <button key={d} type="button" aria-pressed={form.days.includes(d)} className={`chip-filter ${form.days.includes(d) ? 'on' : ''}`}
                  onClick={() => setForm({ ...form, days: form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d] })}>
                  {t(DAY_KEY[d])}
                </button>
              ))}
            </div>
            <p className="text-sm font-semibold text-mute">{t('gn.rs.daysHint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" disabled={busy || !/^\d{2}:\d{2}$/.test(form.time)} onClick={save}>{t('gn.rs.save')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(null)}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        list.length > 0 && <button type="button" className="btn btn-soft btn-sm" onClick={() => setForm(blank())}>{t('gn.rs.add')}</button>
      )}
    </div>
  );
}
