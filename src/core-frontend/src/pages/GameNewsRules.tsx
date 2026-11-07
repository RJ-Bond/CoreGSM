import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { ChatLines, NewsEditor, NewsPreview, Styled } from '../components/NewsEditor';
import { StateView } from '../components/StateView';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import {
  INTERVAL_PRESETS, SWATCHES, WELCOME_STYLES, WELCOME_VARIABLES, composeLine, emptyRule, isHex, isHHMM, validateNews, validateRule,
  type Extras, type JoinLeave, type Welcome, type WelcomeStyle, type NewsServerInfo, type RuleBody, type RuleInfo, type RuleKind,
} from '../gameNews';
import { fromLocalInput, toLocalInput } from '../maintenance';
import { ErrorLine, Field, IconEdit, IconPlus, IconTrash, LoadError, Modal, SaveBadge, Spinner, errText, toast, useAutosave, usePoll } from '../ui';

interface RulesState { timezone: string; restartCountdown: boolean; welcome: Welcome; joinLeave: JoinLeave; extras: Extras; rules: RuleInfo[] }

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
export default function GameNewsRules({ servers, part }: { servers: NewsServerInfo[]; part: 'rules' | 'events' }) {
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
    const { id, lastRun: _l, nextRun: _n, createdBy: _c, upcoming: _u, ...body } = r;
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
  const setCountdown = async (enabled: boolean) => {
    try { await api('/game-news/restart-countdown', 'PUT', { enabled }); void load(); } catch (e) { toast(errText(e), 'err'); }
  };
  const openNew = () => setDraft({ id: null, body: emptyRule() });
  const openEdit = (r: RuleInfo) => { const { id, lastRun: _l, nextRun: _n, createdBy: _c, upcoming: _u, ...body } = r; setDraft({ id, body }); };
  // a copy opens as a new announcement: change what differs and save
  const duplicate = (r: RuleInfo) => {
    const { id: _id, lastRun: _l, nextRun: _n, createdBy: _c, upcoming: _u, ...body } = r;
    setDraft({ id: null, body: { ...body, name: t('gn.a.copyName', { name: r.name }).slice(0, 80) } });
  };

  return (
    <div className="space-y-5">
      {part === 'rules' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 basis-80 text-sm font-semibold text-mute">{t('gn.a.intro')}</p>
          <button type="button" className="btn" onClick={openNew}><IconPlus size={16} />{t('gn.a.add')}</button>
        </div>
      )}

      {data && part === 'events' && (
        <label className="panel flex items-start gap-3 p-4 font-bold">
          <input className="mt-1" type="checkbox" checked={data.restartCountdown} onChange={(e) => void setCountdown(e.target.checked)} />
          <span>
            {t('gn.a.countdown')}
            <span className="block text-sm font-semibold text-mute">{t('gn.a.countdownNote')}</span>
          </span>
        </label>
      )}

      {data && part === 'events' && <JoinLeaveCard initial={data.joinLeave} />}

      {data && part === 'events' && <WelcomeCard initial={data.welcome} />}

      {data && part === 'events' && <ExtrasCard initial={data.extras} />}

      {error && !data ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}
      {!data && !error && <div className="skeleton panel h-32" aria-busy="true" />}

      {data && part === 'rules' && data.rules.length === 0 && (
        <StateView title={t('gn.a.empty')} text={t('gn.a.emptyText')} action={<button type="button" className="btn" onClick={openNew}>{t('gn.a.add')}</button>} />
      )}

      {data && part === 'rules' && data.rules.length > 0 && (
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
                {r.upcoming.length > 1 && (
                  <details className="mt-1 text-sm font-semibold text-mute">
                    <summary className="cursor-pointer">{t('gn.a.upcoming', { n: r.upcoming.length })}</summary>
                    <ul className="mt-1 list-disc pl-5">{r.upcoming.map((ts) => <li key={ts}>{when(ts)}</li>)}</ul>
                  </details>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-soft btn-sm" onClick={() => void toggle(r)}>{r.enabled ? t('gn.a.pause') : t('gn.a.resume')}</button>
                <button type="button" className="btn btn-soft btn-sm" onClick={() => void runNow(r)}>{t('gn.a.run')}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => duplicate(r)}>{t('gn.a.copy')}</button>
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

/**
 * The greeting for a player who joins, shown by the plugin to that player only. One text for everybody or one for a
 * newcomer and one for a returning player; ready styles to start from. Saves by itself.
 */
function WelcomeCard({ initial }: { initial: Welcome }) {
  useI18n();
  const [f, setF] = useState<Welcome>(initial);
  const [saved, setSaved] = useState<Welcome>(initial);
  const set = <K extends keyof Welcome>(k: K, v: Welcome[K]) => setF((x) => ({ ...x, [k]: v }));
  const auto = useAutosave({
    value: f,
    saved,
    delay: 900,
    validate: (v) => {
      if (!v.enabled && !v.text.trim() && !v.newText.trim()) return null;
      const p = validateNews(v.text);
      if (p) return t(p === 'long' ? 'gn.hint.long' : 'gn.hint.text');
      const q = v.split ? validateNews(v.newText) : null;
      return q ? t(q === 'long' ? 'gn.hint.long' : 'gn.hint.text') : null;
    },
    save: async (v) => { await api('/game-news/welcome', 'PUT', v); setSaved(v); },
  });

  const applyStyle = async (st: WelcomeStyle) => {
    if ((f.text.trim() || f.newText.trim()) && !(await confirmDialog({ title: t('gn.w.styleTitle'), text: t('gn.w.styleText'), confirmLabel: t('gn.w.styleApply') }))) return;
    setF((x) => ({ ...x, text: st.text, newText: st.newText, split: true }));
  };

  return (
    <section className="panel space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h3 className="font-extrabold">{t('gn.w.title')}</h3>
          <p className="text-sm font-semibold text-mute">{t('gn.w.note')}</p>
        </div>
        <SaveBadge status={auto.status} error={auto.error} retry={auto.retry} />
      </div>

      <label className="flex items-center gap-2.5 font-bold">
        <input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        {t('gn.w.enabled')}
      </label>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('gn.w.styles')}>
        <span className="text-sm font-bold text-mute">{t('gn.w.styles')}:</span>
        {WELCOME_STYLES.map((st) => (
          <button key={st.id} type="button" className="chip-filter" onClick={() => void applyStyle(st)}>{t(`gn.w.style.${st.id}` as 'gn.w.style.classic')}</button>
        ))}
      </div>

      <label className="flex items-start gap-2.5 font-bold">
        <input className="mt-1" type="checkbox" checked={f.split} onChange={(e) => set('split', e.target.checked)} />
        <span>
          {t('gn.w.split')}
          <span className="block text-sm font-semibold text-mute">{t('gn.w.splitNote')}</span>
        </span>
      </label>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <NewsEditor value={f.text} onChange={(v) => set('text', v)} templates={false} vars={WELCOME_VARIABLES} label={f.split ? t('gn.w.textBack') : t('gn.w.text')} />
          <NewsPreview text={f.text} welcome />
        </div>
        {f.split && (
          <div className="space-y-4">
            <NewsEditor value={f.newText} onChange={(v) => set('newText', v)} templates={false} vars={WELCOME_VARIABLES} label={t('gn.w.textNew')} />
            <NewsPreview text={f.newText || f.text} welcome />
          </div>
        )}
      </div>
      {auto.invalid && f.enabled && <p className="text-sm font-semibold text-danger">{auto.error}</p>}
    </section>
  );
}

/** what {discord} and {tip} stand for: a link or a name, and a list of tips (one at random each time). Saves by itself. */
function ExtrasCard({ initial }: { initial: Extras }) {
  useI18n();
  const [discord, setDiscord] = useState(initial.discord);
  const [tips, setTips] = useState(initial.tips.join('\n'));
  const value: Extras = { discord: discord.trim(), tips: tips.split('\n').map((x) => x.trim()).filter(Boolean) };
  const [saved, setSaved] = useState<Extras>(value);
  const auto = useAutosave({
    value,
    saved,
    delay: 900,
    validate: (v) => (v.tips.length > 20 ? t('gn.x.tooMany') : null),
    save: async (v) => { await api('/game-news/extras', 'PUT', v); setSaved(v); },
  });

  return (
    <section className="panel space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h3 className="font-extrabold">{t('gn.x.title')}</h3>
          <p className="text-sm font-semibold text-mute">{t('gn.x.note')}</p>
        </div>
        <SaveBadge status={auto.status} error={auto.error} retry={auto.retry} />
      </div>
      <Field label={t('gn.x.discord')}>
        <input className="input" value={discord} maxLength={100} placeholder="discord.gg/..." onChange={(e) => setDiscord(e.target.value)} />
      </Field>
      <Field label={t('gn.x.tips')}>
        <textarea className="input min-h-24 text-sm" value={tips} rows={4} placeholder={t('gn.x.tipsEx')} onChange={(e) => setTips(e.target.value)} />
      </Field>
      {auto.invalid && <p className="text-sm font-semibold text-danger">{auto.error}</p>}
    </section>
  );
}

/** a colour: the palette, the system picker and a HEX box */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-bold">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        {SWATCHES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`h-7 w-7 rounded-full border ${value.toUpperCase() === c.hex ? 'border-ink ring-2 ring-ink/40' : 'border-line'}`}
            style={{ background: c.hex }}
            aria-label={`${label}: ${c.hex}`}
            aria-pressed={value.toUpperCase() === c.hex}
            onClick={() => onChange(c.hex)}
          />
        ))}
        <input type="color" className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent p-0.5" value={isHex(value) ? value : '#FFFFFF'} aria-label={label} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <input className="input w-28 font-mono text-sm" value={value} maxLength={7} aria-label={`${label} HEX`} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

/** «* Игрок {name} подключился к серверу.»: shown to everybody when a player joins or leaves, with the colours chosen here. Saves by itself. */
function JoinLeaveCard({ initial }: { initial: JoinLeave }) {
  useI18n();
  const [f, setF] = useState<JoinLeave>(initial);
  const [saved, setSaved] = useState<JoinLeave>(initial);
  const set = <K extends keyof JoinLeave>(k: K, v: JoinLeave[K]) => setF((x) => ({ ...x, [k]: v }));
  const auto = useAutosave({
    value: f,
    saved,
    delay: 800,
    validate: (v) => {
      if (!isHex(v.nameColor) || !isHex(v.textColor)) return t('gn.jl.badColor');
      if ((v.joinEnabled && !v.joinText.trim()) || (v.leaveEnabled && !v.leaveText.trim())) return t('gn.hint.text');
      return null;
    },
    save: async (v) => { await api('/game-news/joinleave', 'PUT', v); setSaved(v); },
  });
  const sample = (text: string) => composeLine(text, isHex(f.nameColor) ? f.nameColor : '#B86BFF', isHex(f.textColor) ? f.textColor : '#5FD068').replace(/{name}/g, 'WhiteLegioN');

  return (
    <section className="panel space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h3 className="font-extrabold">{t('gn.jl.title')}</h3>
          <p className="text-sm font-semibold text-mute">{t('gn.jl.note')}</p>
        </div>
        <SaveBadge status={auto.status} error={auto.error} retry={auto.retry} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <label className="flex items-center gap-2.5 font-bold">
            <input type="checkbox" checked={f.joinEnabled} onChange={(e) => set('joinEnabled', e.target.checked)} />
            {t('gn.jl.join')}
          </label>
          <input className="input" value={f.joinText} maxLength={200} aria-label={t('gn.jl.join')} onChange={(e) => set('joinText', e.target.value)} />
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2.5 font-bold">
            <input type="checkbox" checked={f.leaveEnabled} onChange={(e) => set('leaveEnabled', e.target.checked)} />
            {t('gn.jl.leave')}
          </label>
          <input className="input" value={f.leaveText} maxLength={200} aria-label={t('gn.jl.leave')} onChange={(e) => set('leaveText', e.target.value)} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ColorField label={t('gn.jl.nameColor')} value={f.nameColor} onChange={(v) => set('nameColor', v)} />
        <ColorField label={t('gn.jl.textColor')} value={f.textColor} onChange={(v) => set('textColor', v)} />
      </div>

      <ChatLines lines={[sample(f.joinText), sample(f.leaveText)]} />
      <p className="text-sm font-semibold text-mute">{t('gn.jl.nameHint')}</p>
      {auto.invalid && <p className="text-sm font-semibold text-danger">{auto.error}</p>}
    </section>
  );
}
