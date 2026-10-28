import { useMemo, useState, type FormEvent } from 'react';
import { api, type Server } from '../api';
import { t, useI18n, type TKey } from '../i18n';
import RestartPlans from '../components/RestartPlans';
import StatusNotesCard from '../components/StatusNotesCard';
import WipeScenarios from '../components/WipeScenarios';
import { StateView } from '../components/StateView';
import {
  REPEAT_LABEL, fromLocalInput, presetNow, presetTonight, rangeLabel, toLocalInput, untilLabel, validateWindow, windowState,
  type MaintenanceInput, type MaintenanceRepeat, type MaintenanceWindow, type WindowState,
} from '../maintenance';
import { AdminPage, ErrorLine, Field, FieldError, IconEdit, IconPlus, IconTrash, IconWrench, LoadError, Modal, PageHead, Spinner, undoable, toast, usePoll, errText } from '../ui';

interface Draft { id: number | null; serverId: string; name: string; start: string; end: string; repeat: MaintenanceRepeat }

const emptyDraft = (): Draft => {
  const p = presetNow(Date.now());
  return { id: null, serverId: '', name: t('mt.defName'), start: toLocalInput(p.startTs), end: toLocalInput(p.endTs), repeat: 'none' };
};

const CHIP: Record<WindowState, { text: TKey; cls: string }> = {
  active: { text: 'mt.st.active', cls: 'pill pill-warn' },
  planned: { text: 'mt.st.planned', cls: 'pill pill-mute' },
  repeat: { text: 'mt.st.repeat', cls: 'pill pill-mute' },
  past: { text: 'mt.st.past', cls: 'pill pill-mute' },
};

/** «Обслуживание»: windows during which a server is shown as «Обслуживание» and does not raise alerts. */
export default function MaintenancePage() {
  useI18n();
  const [list, setList] = useState<MaintenanceWindow[] | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hidden, setHidden] = useState<number[]>([]);

  const load = () =>
    Promise.all([
      api<MaintenanceWindow[]>('/maintenance'),
      api<Server[]>('/servers').catch(() => [] as Server[]),
    ]).then(([m, s]) => { setList(Array.isArray(m) ? m : []); setServers(Array.isArray(s) ? s : []); setError(''); })
      .catch((e: Error) => setError(e.message));
  usePoll(load, 30_000);

  const rows = useMemo(() => {
    const now = Date.now();
    const order: Record<WindowState, number> = { active: 0, planned: 1, repeat: 2, past: 3 };
    return (list ?? [])
      .filter((w) => !hidden.includes(w.id))
      .map((w) => ({ w, st: windowState(w, now) }))
      .sort((a, b) => order[a.st] - order[b.st] || (a.w.nextStart ?? a.w.startTs) - (b.w.nextStart ?? b.w.startTs));
  }, [list, hidden]);

  const open = (preset?: { startTs: number; endTs: number }) => {
    const d = emptyDraft();
    if (preset) { d.start = toLocalInput(preset.startTs); d.end = toLocalInput(preset.endTs); }
    setDraft(d);
  };
  const edit = (w: MaintenanceWindow) =>
    setDraft({ id: w.id, serverId: w.serverId == null ? '' : String(w.serverId), name: w.name, start: toLocalInput(w.startTs), end: toLocalInput(w.endTs), repeat: w.repeat });

  const remove = (w: MaintenanceWindow) => {
    setHidden((h) => [...h, w.id]);
    undoable({
      text: t('mt.deleted', { name: w.name }),
      restore: () => setHidden((h) => h.filter((x) => x !== w.id)),
      commit: () => api(`/maintenance/${w.id}`, 'DELETE')
        .catch((e: Error) => toast(e.message, 'err'))
        .finally(() => { setHidden((h) => h.filter((x) => x !== w.id)); void load(); }),
    });
  };

  return (
    <AdminPage
      head={(
        <PageHead
          icon={<IconWrench size={22} />}
          title={t('mt.title')}
          subtitle={t('mt.subtitle')}
          hint={t('mt.hint')}
          help={<p>{t('mt.help')}</p>}
        >
          <button type="button" className="btn" onClick={() => open()}><IconPlus size={16} />{t('mt.add')}</button>
        </PageHead>
      )}
    >
      {error && !list ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('mt.quick')}>
        <button type="button" className="chip-filter" onClick={() => open(presetNow(Date.now()))}>{t('mt.now30')}</button>
        <button type="button" className="chip-filter" onClick={() => open(presetTonight(Date.now()))}>{t('mt.tonight')}</button>
      </div>

      {list && rows.length === 0 && (
        <StateView
          title={t('mt.empty')}
          text={t('mt.emptyText')}
          action={<button type="button" className="btn" onClick={() => open()}>{t('mt.add')}</button>}
        />
      )}
      {!list && !error && <div className="skeleton panel h-40" aria-busy="true" aria-label={t('mt.loading')} />}

      {rows.length > 0 && (
        <ul className="panel divide-y divide-line overflow-hidden">
          {rows.map(({ w, st }) => (
            <li key={w.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
              <div className="min-w-0 flex-1 basis-60">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 wrap-break-word font-extrabold">{w.name}</span>
                  <span className={CHIP[st].cls}>{t(CHIP[st].text)}</span>
                  {w.repeat !== 'none' && st !== 'repeat' && <span className="pill pill-mute">{REPEAT_LABEL[w.repeat]}</span>}
                </div>
                <div className="mt-0.5 wrap-break-word text-sm font-semibold text-mute">
                  {w.serverId == null ? t('mt.allServers') : w.serverName ?? t('mt.serverNo', { id: w.serverId })}
                  {' · '}
                  {rangeLabel(w.startTs, w.endTs)}
                  {st === 'active' && w.until ? ` · ${untilLabel(w.until)}` : ''}
                  {st !== 'active' && w.repeat !== 'none' && w.nextStart ? ` · ${t('mt.next', { range: rangeLabel(w.nextStart, w.nextStart + (w.endTs - w.startTs)) })}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="btn btn-soft btn-sm" onClick={() => edit(w)} aria-label={t('mt.editAria', { name: w.name })}><IconEdit size={16} />{t('mt.edit')}</button>
                <button type="button" className="row-act row-act-danger" onClick={() => remove(w)} aria-label={t('mt.delAria', { name: w.name })}><IconTrash size={16} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <StatusNotesCard servers={servers} />
      <RestartPlans servers={servers} />
      <WipeScenarios servers={servers} />

      {draft && <WindowModal draft={draft} servers={servers} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); void load(); }} />}
    </AdminPage>
  );
}

function WindowModal({ draft, servers, onClose, onSaved }: { draft: Draft; servers: Server[]; onClose: () => void; onSaved: () => void }) {
  useI18n();
  const [f, setF] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const startTs = fromLocalInput(f.start);
  const endTs = fromLocalInput(f.end);
  const problem = validateWindow({ name: f.name, startTs, endTs, repeat: f.repeat });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((x) => ({ ...x, [k]: v }));
  const apply = (p: { startTs: number; endTs: number }) => setF((x) => ({ ...x, start: toLocalInput(p.startTs), end: toLocalInput(p.endTs) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problem || startTs == null || endTs == null || busy) return;
    const body: MaintenanceInput = { serverId: f.serverId === '' ? null : Number(f.serverId), name: f.name.trim(), startTs, endTs, repeat: f.repeat };
    setBusy(true);
    setError('');
    try {
      await (f.id == null ? api('/maintenance', 'POST', body) : api(`/maintenance/${f.id}`, 'PUT', body));
      toast(f.id == null ? t('mt.added') : t('mt.saved'));
      onSaved();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={f.id == null ? t('mt.newTitle') : t('mt.editTitle')} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
        <Field label={t('mt.f.server')}>
          <select className="input" value={f.serverId} onChange={(e) => set('serverId', e.target.value)}>
            <option value="">{t('mt.allServers')}</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label={t('mt.f.name')}>
          <input className="input" value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} placeholder={t('mt.f.namePh')} />
        </Field>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('mt.quickTime')}>
          <button type="button" className="chip-filter" onClick={() => apply(presetNow(Date.now()))}>{t('mt.now30')}</button>
          <button type="button" className="chip-filter" onClick={() => apply(presetTonight(Date.now()))}>{t('mt.tonight')}</button>
        </div>
        <div className="grid gap-4 min-[460px]:grid-cols-2">
          <Field label={t('mt.f.start')}><input className="input" type="datetime-local" value={f.start} onChange={(e) => set('start', e.target.value)} /></Field>
          <Field label={t('mt.f.end')}><input className="input" type="datetime-local" value={f.end} onChange={(e) => set('end', e.target.value)} /></Field>
        </div>
        <Field label={t('mt.f.repeat')}>
          <select className="input" value={f.repeat} onChange={(e) => set('repeat', e.target.value as MaintenanceRepeat)}>
            <option value="none">{t('mt.r.none')}</option>
            <option value="daily">{t('mt.r.daily')}</option>
            <option value="weekly">{t('mt.r.weekly')}</option>
          </select>
        </Field>
        <p className="text-sm font-semibold text-mute">{t('mt.tzNote')}</p>
        <FieldError id="maint-problem" text={f.name.trim() && f.start && f.end ? problem ?? undefined : undefined} />
        <ErrorLine text={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn" disabled={!!problem || busy}>{busy && <Spinner />}{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}
