import { useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { NewsEditor, NewsPreview, Styled } from '../components/NewsEditor';
import { soon } from '../components/GameNewsParts';
import RowMenu from '../components/RowMenu';
import { GroupedList } from '../ui/lists';
import { IconAuto, IconChat, IconRestart, IconShield } from '../components/GameNewsIcons';
import { StateView } from '../components/StateView';
import { Switch } from '../components/Switch';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import { INTERVAL_PRESETS, emptyRule, isHHMM, validateRule, type NewsServerInfo, type RuleBody, type RuleInfo, type RuleKind } from '../gameNews';
import { fromLocalInput, toLocalInput } from '../maintenance';
import { ErrorLine, Field, IconPlus, Modal, Spinner, errText, toast } from '../ui';

function everyLabel(min: number): string {
  if (min % 1440 === 0) return t('gn.a.everyDays', { n: min / 1440 });
  if (min % 60 === 0) return t('gn.a.everyHours', { n: min / 60 });
  return t('gn.a.everyMin', { n: min });
}

function scheduleLabel(r: RuleInfo): string {
  if (r.kind === 'interval') return everyLabel(r.everyMin);
  if (r.kind === 'daily') return t('gn.a.dailyAt', { times: r.times.join(', ') });
  return t('gn.a.onceAt', { time: soon(r.runAt) });
}

/** the examples of the empty list: a name and a text from the locale, the schedule here */
const EXAMPLES: { id: 'discord' | 'restart' | 'rules'; icon: typeof IconAuto; kind: 'interval' | 'daily'; everyMin: number; times: string[] }[] = [
  { id: 'discord', icon: IconChat, kind: 'interval', everyMin: 30, times: ['20:00'] },
  { id: 'restart', icon: IconRestart, kind: 'daily', everyMin: 60, times: ['03:50'] },
  { id: 'rules', icon: IconShield, kind: 'interval', everyMin: 60, times: ['20:00'] },
];

/** «Автообъявления»: a message written once and sent by a schedule, without pressing «Отправить». */
export default function GameNewsRules({ servers, rules, timezone, reload }: { servers: NewsServerInfo[]; rules: RuleInfo[]; timezone: string; reload: () => void }) {
  useI18n();
  const [draft, setDraft] = useState<{ id: number | null; body: RuleBody } | null>(null);

  const serverNames = (ids: number[]) => (ids.length ? servers.filter((s) => ids.includes(s.id)).map((s) => s.name).join(', ') || '—' : t('gn.a.allServers'));
  const bodyOf = (r: RuleInfo): RuleBody => {
    const { id: _id, lastRun: _l, nextRun: _n, createdBy: _c, upcoming: _u, expired: _e, ...body } = r;
    return body;
  };
  const toggle = async (r: RuleInfo, enabled: boolean) => {
    try { await api(`/game-news/rules/${r.id}`, 'PUT', { ...bodyOf(r), enabled }); reload(); } catch (e) { toast(errText(e), 'err'); }
  };
  const runNow = async (r: RuleInfo) => {
    if (!(await confirmDialog({ title: t('gn.a.runTitle', { name: r.name }), text: t('gn.a.runText'), confirmLabel: t('gn.a.run') }))) return;
    try {
      const res = await api<{ results: { queued: boolean }[] }>(`/game-news/rules/${r.id}/run`, 'POST');
      toast(res.results.some((x) => x.queued) ? t('gn.t.queued') : t('gn.a.nobody'), res.results.some((x) => x.queued) ? undefined : 'err');
      reload();
    } catch (e) { toast(errText(e), 'err'); }
  };
  const remove = async (r: RuleInfo) => {
    if (!(await confirmDialog({ title: t('gn.a.delTitle', { name: r.name }), danger: true, confirmLabel: t('gn.a.del') }))) return;
    try { await api(`/game-news/rules/${r.id}`, 'DELETE'); reload(); } catch (e) { toast(errText(e), 'err'); }
  };
  // the rules by state: the ones that work, the ones whose period is over, the ones switched off
  const ruleGroups = [
    { id: 'on', title: t('gn.a.g.on'), tone: 'ok' as const, items: rules.filter((r) => r.enabled && !r.expired) },
    { id: 'expired', title: t('gn.a.g.expired'), tone: 'warn' as const, items: rules.filter((r) => r.enabled && r.expired) },
    { id: 'off', title: t('gn.a.g.off'), tone: 'mute' as const, items: rules.filter((r) => !r.enabled), folded: true },
  ];
  const openNew = () => setDraft({ id: null, body: emptyRule() });
  // a copy opens as a new announcement: change what differs and save
  const duplicate = (r: RuleInfo) => setDraft({ id: null, body: { ...bodyOf(r), name: t('gn.a.copyName', { name: r.name }).slice(0, 80) } });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 basis-80 text-sm font-semibold text-mute">{t('gn.a.intro')}</p>
        <button type="button" className="btn" onClick={openNew}><IconPlus size={16} />{t('gn.a.add')}</button>
      </div>

      {rules.length === 0 && (
        <>
          <StateView scene="chat" title={t('gn.a.empty')} text={t('gn.a.emptyText')} action={<button type="button" className="btn" onClick={openNew}>{t('gn.a.add')}</button>} />
          {/* ready examples: one tap opens the form filled in */}
          <section aria-label={t('gn.a.examples')}>
            <h3 className="mb-2 text-sm font-extrabold text-mute">{t('gn.a.examples')}</h3>
            <ul className="grid gap-3 sm:grid-cols-3">
              {EXAMPLES.map((x) => (
                <li key={x.id}>
                  <button type="button" className="panel flex h-full w-full items-start gap-3 p-4 text-left transition hover:shadow-pop" onClick={() => setDraft({ id: null, body: { ...emptyRule(), name: t(`gn.a.ex.${x.id}.name` as 'gn.a.ex.discord.name'), text: t(`gn.a.ex.${x.id}.text` as 'gn.a.ex.discord.text'), kind: x.kind, everyMin: x.everyMin, times: x.times } })}>
                    <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-soft text-link"><x.icon size={20} /></span>
                    <span className="min-w-0">
                      <span className="block font-bold">{t(`gn.a.ex.${x.id}.name` as 'gn.a.ex.discord.name')}</span>
                      <span className="block text-sm font-semibold text-mute">{x.kind === 'interval' ? everyLabel(x.everyMin) : t('gn.a.dailyAt', { times: x.times.join(', ') })}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {rules.length > 0 && (
        <GroupedList
          storageKey="autorules"
          itemKey={(r) => r.id}
          groups={ruleGroups}
          render={(r) => (
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4">
              <Switch className="mt-1" checked={r.enabled} aria-label={`${r.name}: ${r.enabled ? t('gn.a.on') : t('gn.a.off')}`} onChange={(v) => void toggle(r, v)} />
              <div className="min-w-0 flex-1 basis-40">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 wrap-break-word font-extrabold">{r.name}</span>
                  <span className="pill pill-mute">{scheduleLabel(r)}</span>
                </div>
                <p className="mt-1 wrap-break-word text-sm"><Styled text={r.text} /></p>
                <p className="mt-1 text-sm font-semibold text-mute">
                  {serverNames(r.serverIds)}
                  {' · '}{r.enabled ? (r.expired ? t('gn.a.expired') : r.nextRun ? t('gn.a.next', { time: soon(r.nextRun) }) : t('gn.a.noNext')) : t('gn.a.off')}
                  {r.lastRun ? ` · ${t('gn.a.last', { time: soon(r.lastRun) })}` : ''}
                </p>
                {r.upcoming.length > 1 && (
                  <details className="mt-1 text-sm font-semibold text-mute">
                    <summary className="cursor-pointer">{t('gn.a.upcoming', { n: r.upcoming.length })}</summary>
                    <ul className="mt-1 list-disc pl-5">{r.upcoming.map((ts) => <li key={ts}>{soon(ts)}</li>)}</ul>
                  </details>
                )}
              </div>
              <RowMenu
                className="ml-auto"
                label={t('gn.a.menu', { name: r.name })}
                items={[
                  { key: 'run', label: t('gn.a.run'), shortcut: 'r', onSelect: () => void runNow(r) },
                  { key: 'edit', label: t('gn.a.edit'), shortcut: 'e', onSelect: () => setDraft({ id: r.id, body: bodyOf(r) }) },
                  { key: 'copy', label: t('gn.a.copy'), shortcut: 'd', onSelect: () => duplicate(r) },
                  { key: 'del', label: t('gn.a.del'), danger: true, sep: true, shortcut: 'Delete', onSelect: () => void remove(r) },
                ]}
              />
            </div>
          )}
        />
      )}

      {draft && (
        <RuleModal
          id={draft.id}
          initial={draft.body}
          servers={servers}
          timezone={timezone}
          onClose={() => setDraft(null)}
          onSaved={() => { setDraft(null); reload(); }}
        />
      )}
    </div>
  );
}

export function RuleModal({ id, initial, servers, timezone, onClose, onSaved }: {
  id: number | null; initial: RuleBody; servers: NewsServerInfo[]; timezone: string; onClose: () => void; onSaved: () => void;
}) {
  useI18n();
  const [f, setF] = useState<RuleBody>(initial);
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // after a press on «Сохранить» the reason is shown even before the name is typed (a disabled button said nothing)
  const [tried, setTried] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
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
    if (busy) return;
    if (problem) {
      setTried(true);
      if (problem === 'name') nameRef.current?.focus();
      return;
    }
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
          <input ref={nameRef} className="input" value={f.name} maxLength={80} placeholder={t('gn.a.nameEx')} onChange={(e) => set('name', e.target.value)} />
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

        {problem && (tried || f.name.trim()) && <p role="alert" className="text-sm font-semibold text-bad">{t(`gn.a.p.${problem}` as 'gn.a.p.name')}</p>}
        <ErrorLine text={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn" disabled={busy}>{busy && <Spinner />}{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}
