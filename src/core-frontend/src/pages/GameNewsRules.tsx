import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { NewsEditor, NewsPreview, Styled } from '../components/NewsEditor';
import { StateView } from '../components/StateView';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import {
  INTERVAL_PRESETS, emptyRule, isHHMM, validateRule,
  type NewsServerInfo, type RuleBody, type RuleInfo, type RuleKind,
} from '../gameNews';
import { fromLocalInput, toLocalInput } from '../maintenance';
import { ErrorLine, Field, IconEdit, IconPlus, IconTrash, LoadError, Modal, Spinner, errText, toast, usePoll } from '../ui';

interface RulesState { timezone: string; rules: RuleInfo[] }

const when = (ts: number | null) => (ts ? new Date(ts).toLocaleString() : '—');

function everyLabel(min: number): string {
  if (min % 1440 === 0) return t('gn.a.everyDays', { n: min / 1440 });
  if (min % 60 === 0) return t('gn.a.everyHours', { n: min / 60 });
  return t('gn.a.everyMin', { n: min });
}

function scheduleLabel(r: RuleInfo): string {
  if (r.kind === 'interval') return everyLabel(r.everyMin);
  if (r.kind === 'daily') return t('gn.a.dailyAt', { times: r.times.join(', ') });
  return t('gn.a.onceAt', { time: when(r.runAt) });
}

/** «Автообъявления»: a message written once and sent by a schedule, without pressing «Отправить». */
export default function GameNewsRules({ servers }: { servers: NewsServerInfo[] }) {
  useI18n();
  const [data, setData] = useState<RulesState | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<{ id: number | null; body: RuleBody } | null>(null);

  const load = () =>
    api<RulesState>('/game-news/rules')
      .then((d) => { setData(d); setError(''); })
      .catch((e: Error) => setError(e.message));
  usePoll(load, 15_000);

  const serverNames = (ids: number[]) => (ids.length ? servers.filter((s) => ids.includes(s.id)).map((s) => s.name).join(', ') || '—' : t('gn.a.allServers'));
  const toggle = async (r: RuleInfo) => {
    const { id, lastRun: _l, nextRun: _n, createdBy: _c, ...body } = r;
    try { await api(`/game-news/rules/${id}`, 'PUT', { ...body, enabled: !r.enabled }); void load(); } catch (e) { toast(errText(e), 'err'); }
  };
  const runNow = async (r: RuleInfo) => {
    if (!(await confirmDialog({ title: t('gn.a.runTitle', { name: r.name }), text: t('gn.a.runText'), confirmLabel: t('gn.a.run') }))) return;
    try {
      const res = await api<{ results: { queued: boolean }[] }>(`/game-news/rules/${r.id}/run`, 'POST');
      toast(res.results.some((x) => x.queued) ? t('gn.t.queued') : t('gn.a.nobody'), res.results.some((x) => x.queued) ? undefined : 'err');
      void load();
    } catch (e) { toast(errText(e), 'err'); }
  };
  const remove = async (r: RuleInfo) => {
    if (!(await confirmDialog({ title: t('gn.a.delTitle', { name: r.name }), danger: true, confirmLabel: t('gn.a.del') }))) return;
    try { await api(`/game-news/rules/${r.id}`, 'DELETE'); void load(); } catch (e) { toast(errText(e), 'err'); }
  };
  const openNew = () => setDraft({ id: null, body: emptyRule() });
  const openEdit = (r: RuleInfo) => { const { id, lastRun: _l, nextRun: _n, createdBy: _c, ...body } = r; setDraft({ id, body }); };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 basis-80 text-sm font-semibold text-mute">{t('gn.a.intro')}</p>
        <button type="button" className="btn" onClick={openNew}><IconPlus size={16} />{t('gn.a.add')}</button>
      </div>

      {error && !data ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}
      {!data && !error && <div className="skeleton panel h-32" aria-busy="true" />}

      {data && data.rules.length === 0 && (
        <StateView title={t('gn.a.empty')} text={t('gn.a.emptyText')} action={<button type="button" className="btn" onClick={openNew}>{t('gn.a.add')}</button>} />
      )}

      {data && data.rules.length > 0 && (
        <ul className="panel divide-y divide-line overflow-hidden">
          {data.rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4">
              <div className="min-w-0 flex-1 basis-72">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 wrap-break-word font-extrabold">{r.name}</span>
                  <span className={r.enabled ? 'pill pill-ok' : 'pill pill-mute'}>{r.enabled ? t('gn.a.on') : t('gn.a.off')}</span>
                  <span className="pill pill-mute">{scheduleLabel(r)}</span>
                </div>
                <p className="mt-1 wrap-break-word text-sm"><Styled text={r.text} /></p>
                <p className="mt-1 text-sm font-semibold text-mute">
                  {serverNames(r.serverIds)}
                  {' · '}{r.nextRun ? t('gn.a.next', { time: when(r.nextRun) }) : t('gn.a.noNext')}
                  {' · '}{t('gn.a.last', { time: when(r.lastRun) })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-soft btn-sm" onClick={() => void toggle(r)}>{r.enabled ? t('gn.a.pause') : t('gn.a.resume')}</button>
                <button type="button" className="btn btn-soft btn-sm" onClick={() => void runNow(r)}>{t('gn.a.run')}</button>
                <button type="button" className="row-act" onClick={() => openEdit(r)} aria-label={t('gn.a.editAria', { name: r.name })}><IconEdit size={16} /></button>
                <button type="button" className="row-act row-act-danger" onClick={() => void remove(r)} aria-label={t('gn.a.delAria', { name: r.name })}><IconTrash size={16} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <RuleModal
          id={draft.id}
          initial={draft.body}
          servers={servers}
          timezone={data?.timezone ?? ''}
          onClose={() => setDraft(null)}
          onSaved={() => { setDraft(null); void load(); }}
        />
      )}
    </div>
  );
}

function RuleModal({ id, initial, servers, timezone, onClose, onSaved }: {
  id: number | null; initial: RuleBody; servers: NewsServerInfo[]; timezone: string; onClose: () => void; onSaved: () => void;
}) {
  useI18n();
  const [f, setF] = useState<RuleBody>(initial);
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof RuleBody>(k: K, v: RuleBody[K]) => setF((x) => ({ ...x, [k]: v }));
  const problem = validateRule(f, Date.now());
  const withPlugin = servers.filter((s) => s.hasToken);

  const addTime = () => {
    if (!isHHMM(time) || f.times.includes(time)) return;
    set('times', [...f.times, time].sort());
    setTime('');
  };
  const toggleServer = (sid: number) => set('serverIds', f.serverIds.includes(sid) ? f.serverIds.filter((x) => x !== sid) : [...f.serverIds, sid]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problem || busy) return;
    setBusy(true);
    setError('');
    try {
      await (id == null ? api('/game-news/rules', 'POST', f) : api(`/game-news/rules/${id}`, 'PUT', f));
      toast(t('gn.a.saved'));
      onSaved();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={id == null ? t('gn.a.newTitle') : t('gn.a.editTitle')} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
        <Field label={t('gn.a.name')}>
          <input className="input" value={f.name} maxLength={80} placeholder={t('gn.a.nameEx')} onChange={(e) => set('name', e.target.value)} />
        </Field>

        <NewsEditor value={f.text} onChange={(v) => set('text', v)} />
        <NewsPreview text={f.text} />

        <Field label={t('gn.a.when')}>
          <select className="input" value={f.kind} onChange={(e) => set('kind', e.target.value as RuleKind)}>
            <option value="interval">{t('gn.a.kind.interval')}</option>
            <option value="daily">{t('gn.a.kind.daily')}</option>
            <option value="once">{t('gn.a.kind.once')}</option>
          </select>
        </Field>

        {f.kind === 'interval' && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {INTERVAL_PRESETS.map((m) => (
                <button key={m} type="button" className={`chip-filter ${f.everyMin === m ? 'on' : ''}`} aria-pressed={f.everyMin === m} onClick={() => set('everyMin', m)}>{everyLabel(m)}</button>
              ))}
            </div>
            <Field label={t('gn.a.everyMinutes')}>
              <input className="input w-40" type="number" min={5} max={10080} value={f.everyMin} onChange={(e) => set('everyMin', Number(e.target.value))} />
            </Field>
            <p className="text-sm font-semibold text-mute">{t('gn.a.intervalNote')}</p>
          </div>
        )}

        {f.kind === 'daily' && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {f.times.map((x) => (
                <button key={x} type="button" className="chip-filter on" onClick={() => set('times', f.times.filter((y) => y !== x))} aria-label={t('gn.a.removeTime', { time: x })}>{x} ✕</button>
              ))}
              <input className="input w-32" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={t('gn.a.time')} />
              <button type="button" className="btn btn-soft btn-sm" disabled={!isHHMM(time) || f.times.includes(time)} onClick={addTime}>{t('gn.a.addTime')}</button>
            </div>
            <p className="text-sm font-semibold text-mute">{t('gn.a.tzNote', { tz: timezone || '—' })}</p>
          </div>
        )}

        {f.kind === 'once' && (
          <Field label={t('gn.a.runAt')}>
            <input className="input" type="datetime-local" value={f.runAt ? toLocalInput(f.runAt) : ''} onChange={(e) => set('runAt', fromLocalInput(e.target.value))} />
          </Field>
        )}

        <div className="space-y-2">
          <span className="text-sm font-bold">{t('gn.a.servers')}</span>
          <label className="flex items-center gap-2.5 font-bold">
            <input type="checkbox" checked={f.serverIds.length === 0} onChange={() => set('serverIds', [])} />
            {t('gn.a.allServers')}
          </label>
          {withPlugin.map((s) => (
            <label key={s.id} className="flex items-center gap-2.5 font-bold">
              <input type="checkbox" checked={f.serverIds.includes(s.id)} onChange={() => toggleServer(s.id)} />
              <span className="min-w-0 wrap-break-word">{s.name}</span>
            </label>
          ))}
        </div>

        <label className="flex items-start gap-2.5 font-bold">
          <input className="mt-1" type="checkbox" checked={f.onlyOnline} onChange={(e) => set('onlyOnline', e.target.checked)} />
          <span>{t('gn.a.onlyOnline')}<span className="block text-sm font-semibold text-mute">{t('gn.a.onlyOnlineNote')}</span></span>
        </label>

        {f.kind !== 'once' && (
          <div className="grid gap-4 min-[460px]:grid-cols-2">
            <Field label={t('gn.a.from')}>
              <input className="input" type="datetime-local" value={f.activeFrom ? toLocalInput(f.activeFrom) : ''} onChange={(e) => set('activeFrom', fromLocalInput(e.target.value))} />
            </Field>
            <Field label={t('gn.a.to')}>
              <input className="input" type="datetime-local" value={f.activeTo ? toLocalInput(f.activeTo) : ''} onChange={(e) => set('activeTo', fromLocalInput(e.target.value))} />
            </Field>
          </div>
        )}

        <label className="flex items-center gap-2.5 font-bold">
          <input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          {t('gn.a.enabled')}
        </label>

        {problem && f.name.trim() && <p className="text-sm font-semibold text-danger">{t(`gn.a.p.${problem}` as 'gn.a.p.name')}</p>}
        <ErrorLine text={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn" disabled={!!problem || busy}>{busy && <Spinner />}{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}
