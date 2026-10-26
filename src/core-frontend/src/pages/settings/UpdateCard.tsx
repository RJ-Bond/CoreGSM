/** Settings → Updates: version check, changelog, update and rollback through the host updater. */
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { api, type Changelog, type UpdateInfo, type UpdateNotes, type UpdatePreflight } from '../../api';
import { confirmDialog } from '../../confirm';
import { t } from '../../i18n';
import { ago, ErrorLine, fmtDate, IconArrowUp, IconCheck, Spinner, usePoll, errText } from '../../ui';
import { HistoryCard, NotesCard, OptionsCard, PreflightNote, StepList } from './updateParts';
import { offered, versionText } from './updateLogic';

const DISMISS_KEY = 'coregsm_dismissed_update_error';
const readDismissed = (): number => {
  try { return Number(localStorage.getItem(DISMISS_KEY)) || 0; } catch { return 0; }
};
const rememberDismissed = (t: number) => {
  try { localStorage.setItem(DISMISS_KEY, String(t)); } catch { /* not remembered */ }
};

export function UpdateCard() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // set when "Update" or "Rollback" was pressed: remembers the previous job timestamp to recognise the new result
  const [waiting, setWaiting] = useState<{ since: number; baseTime: number | null; kind: 'update' | 'rollback' } | null>(null);
  const [offline, setOffline] = useState(false);
  const [log, setLog] = useState<Changelog | null>(null);
  const [logError, setLogError] = useState('');
  const [notes, setNotes] = useState<UpdateNotes | null>(null);
  const [pf, setPf] = useState<UpdatePreflight | null>(null);

  useEffect(() => {
    api<Changelog>('/update/changelog')
      .then((r) => { setLog(r); setLogError(r.error ?? ''); })
      .catch((e: Error) => setLogError(e.message));
    api<UpdateNotes>('/update/notes').then(setNotes).catch(() => setNotes({ releases: [], error: null }));
    api<UpdatePreflight>('/update/preflight').then(setPf).catch(() => undefined);
  }, []);

  // percent of the running job: only grows while the same job runs (never goes backwards between polls)
  const [pct, setPct] = useState<number | null>(null);
  const pctJob = useRef<number | null>(null);
  const [finished, setFinished] = useState<'update' | 'rollback' | null>(null);
  const running = !!waiting || info?.job?.state === 'running';

  usePoll(() => {
    api<UpdateInfo>('/update/status')
      .then((r) => {
        setOffline(false);
        setInfo(r);
        const j = r.job;
        const current = !!j && (j.state === 'running' || (!!waiting && j.time !== waiting.baseTime));
        if (j && current && typeof j.progress === 'number') {
          const p = Math.max(0, Math.min(100, Math.round(j.progress)));
          if (pctJob.current !== j.time) { pctJob.current = j.time; setPct(p); } else setPct((c) => Math.max(c ?? 0, p));
        }
        if (!waiting || !j || j.time === waiting.baseTime) return;
        if (j.state === 'done') {
          setFinished(waiting.kind);
          setPct(100);
          setWaiting(null);
          // new frontend files are served now: reload to pick them up
          setTimeout(() => window.location.reload(), 1500);
        } else if (j.state === 'error') {
          setWaiting(null);
          setError(j.message);
        }
      })
      .catch(() => {
        // the backend restarts during an update
        if (waiting || info?.job?.state === 'running') setOffline(true);
      });
  }, running && !finished ? 2_000 : 30_000);

  const check = async () => {
    setBusy(true);
    setError('');
    try {
      setInfo(await api<UpdateInfo>('/update/check', 'POST'));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    const players = pf?.players ?? 0;
    const text = players > 0 ? `${t('upd.c.text')}\n\n${t('upd.c.players', { n: players })}` : t('upd.c.text');
    if (!(await confirmDialog({ title: t('upd.c.title'), text, confirmLabel: t('upd.c.ok') }))) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<UpdateInfo>('/update/apply', 'POST');
      setInfo(r);
      setPct(null);
      setFinished(null);
      setWaiting({ since: Date.now(), baseTime: r.job?.time ?? null, kind: 'update' });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const rollback = async () => {
    const ok = await confirmDialog({
      title: t('upd.rb.title'),
      text: t('upd.rb.text'),
      confirmLabel: t('upd.rb.ok'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<UpdateInfo>('/update/rollback', 'POST');
      setInfo(r);
      setPct(null);
      setFinished(null);
      setWaiting({ since: Date.now(), baseTime: r.job?.time ?? null, kind: 'rollback' });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const rollingBack = (waiting?.kind ?? finished) === 'rollback' || (info?.stage === 'rollback' && running);
  // an old failure matters only while an update is still pending; a manual install that succeeded makes it moot
  const [dismissed, setDismissed] = useState<number>(readDismissed);
  const showOldFailure = !running && !error && info?.job?.state === 'error' && !!info.available && info.job.time !== dismissed;
  const stuck = !!waiting && Date.now() - waiting.since > 60_000 && !!info?.pending;

  const skipped = !!info?.available && !!info.skipped;
  const state: 'running' | 'available' | 'latest' | 'skipped' | 'unknown' = running || finished ? 'running' : offered(info) ? 'available' : skipped ? 'skipped' : info?.latest ? 'latest' : 'unknown';
  const lastChecked = info?.checkedAt ?? null;
  const onGrad = state === 'available' || state === 'running';
  const curText = versionText(info?.currentLabel, info?.current);
  const newText = versionText(info?.latestLabel, info?.latest);

  const setSkip = async (build: string | null) => {
    setBusy(true);
    setError('');
    try {
      setInfo(await api<UpdateInfo>('/update/settings', 'PUT', { skip: build }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const title =
    state === 'running' ? (rollingBack ? t('upd.t.rolling') : t('upd.t.running'))
    : state === 'available' ? t('upd.t.available')
    : state === 'latest' ? t('upd.t.latest')
    : state === 'skipped' ? t('upd.t.skipped')
    : t('upd.t.checking');
  const subtitle =
    state === 'running'
      ? finished ? t('upd.s.done') : offline ? t('upd.s.restarting') : info?.job?.state === 'running' && info.job.message ? info.job.message : ''
      : state === 'available' ? t('upd.s.available')
      : state === 'latest' ? (lastChecked ? t('upd.s.latestChecked', { when: ago(lastChecked) }) : t('upd.s.latest'))
      : state === 'skipped' ? t('upd.s.skipped', { v: newText })
      : t('upd.s.checking');

  return (
    <div className="space-y-5">
      <section
        aria-live="polite"
        className={`relative overflow-hidden rounded-ui-xl p-6 sm:p-7 ${
          state === 'available' ? 'update-hero text-white' : state === 'running' ? 'update-hero update-hero-run text-white' : 'panel'
        }`}
      >
        {onGrad && <span aria-hidden className="pointer-events-none absolute -right-14 -top-14 h-56 w-56 rounded-full bg-white/15" />}
        <div className="relative flex flex-wrap items-start gap-4">
          <span
            aria-hidden
            className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${
              onGrad ? 'bg-white/20 text-white' : state === 'latest' ? 'bg-okbg text-ok' : 'bg-soft text-mute'
            }`}
          >
            {state === 'latest' ? (
              <IconCheck size={30} />
            ) : state === 'running' ? (
              <Spinner className="h-7 w-7" />
            ) : (
              <IconArrowUp size={30} className={state === 'available' ? 'update-bob' : ''} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-extrabold leading-tight" style={{ letterSpacing: '-0.02em' }}>{title}</h2>
            <p className={`mt-1 font-semibold ${onGrad ? 'text-white/90' : 'text-mute'}`}>{subtitle}</p>

            <dl className="mt-4 flex flex-wrap items-center gap-2 text-sm font-bold">
              <div className={`flex flex-wrap items-center gap-x-2 rounded-full px-3.5 py-1.5 ${onGrad ? 'bg-white/20' : 'bg-soft'}`}>
                <dt className={onGrad ? 'text-white/85' : 'text-mute'}>{t('upd.installed')}</dt>
                <dd className="font-mono">{curText}</dd>
                {info?.installedAt ? <dd className={`font-sans font-semibold ${onGrad ? 'text-white/80' : 'text-mute'}`}>{t('upd.since', { date: fmtDate(info.installedAt) })}</dd> : null}
              </div>
              {state === 'available' && <span aria-hidden className="text-lg font-black text-white/90">→</span>}
              <div className={`flex flex-wrap items-center gap-x-2 rounded-full px-3.5 py-1.5 ${state === 'available' ? 'bg-white text-ink' : state === 'running' ? 'bg-white/20' : 'bg-soft'}`}>
                <dt className={state === 'running' ? 'text-white/85' : 'text-mute'}>{t('upd.inRepo')}</dt>
                <dd className="font-mono">{newText}</dd>
                {info?.latestAt ? <dd className="font-sans font-semibold text-mute">{t('upd.from', { date: fmtDate(info.latestAt) })}</dd> : null}
              </div>
            </dl>
          </div>
        </div>

        {state === 'running' && (
          <div className="relative mt-5 space-y-3">
            {!rollingBack && <StepList stage={info?.stage} finished={!!finished} />}
            <div className="flex items-center gap-3">
              <div
                className={`update-progress min-w-0 flex-1 ${pct != null ? 'det' : ''}`}
                role="progressbar"
                aria-label={rollingBack ? t('upd.aria.rollback') : t('upd.aria.update')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct ?? undefined}
              >
                <i style={pct != null ? ({ '--p': `${pct}%` } as CSSProperties) : undefined} />
              </div>
              {pct != null && <span className="w-14 shrink-0 text-right text-lg font-black tabular-nums" aria-hidden>{pct} %</span>}
              {finished && (
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-okbg text-ok" aria-hidden>
                  <IconCheck size={16} />
                </span>
              )}
            </div>
          </div>
        )}

        {state === 'available' && <PreflightNote pf={pf} current={info?.currentLabel} notes={notes} />}

        <div className="relative mt-5 flex flex-wrap items-center gap-2.5">
          {state === 'available' && (
            <>
              <button className="btn-on-grad btn-lg" onClick={apply} disabled={busy || running || !info?.canApply}>
                {busy ? t('upd.btn.sending') : t('upd.btn.now')}
              </button>
              <a className="btn-ghost-on-grad" href="#update-changes" onClick={(e) => { e.preventDefault(); document.getElementById('update-changes')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{t('upd.btn.notes')}</a>
              <button className="btn-ghost-on-grad" onClick={check} disabled={busy || running}>{t('upd.btn.recheck')}</button>
              {info?.latest && <button className="btn-ghost-on-grad" onClick={() => void setSkip(info.latest)} disabled={busy || running}>{t('upd.btn.skip')}</button>}
            </>
          )}
          {state === 'skipped' && (
            <>
              <button className="btn" onClick={apply} disabled={busy || running || !info?.canApply}>{t('upd.btn.anyway')}</button>
              <button className="btn btn-soft" onClick={() => void setSkip(null)} disabled={busy || running}>{t('upd.btn.unskip')}</button>
            </>
          )}
          {(state === 'latest' || state === 'unknown') && (
            <button className="btn" onClick={check} disabled={busy || running}>{busy ? t('upd.btn.checking') : t('upd.btn.check')}</button>
          )}
          {info?.canRollback && state !== 'running' && (
            <button className={`${state === 'available' ? 'btn-ghost-on-grad' : 'btn btn-soft'} sm:ml-auto`} onClick={() => void rollback()} disabled={busy || running}>{t('upd.btn.rollback')}</button>
          )}
        </div>

        {info && !info.canApply && state !== 'running' && (
          <p className={`relative mt-3 text-sm font-semibold ${state === 'available' ? 'rounded-2xl bg-black/15 px-4 py-2.5 font-bold' : 'text-mute'}`}>
            {t('upd.noApply')} <span className="font-mono">sudo coregsm update</span>.
          </p>
        )}
        {stuck && (
          <p className="relative mt-3 rounded-2xl bg-badbg px-4 py-2.5 text-sm font-bold text-bad">
            {t('upd.stuck')} <span className="font-mono">systemctl status coregsm-update.path</span> {rollingBack ? t('upd.stuckRb') : <>{t('upd.stuckUp')} <span className="font-mono">sudo coregsm update</span></>}.
          </p>
        )}
        {info?.error && !running && <p className="relative mt-3 text-sm font-semibold text-mute">{info.error}</p>}
        {showOldFailure && info?.job && (
          <div className="relative mt-3 flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-badbg px-4 py-2.5 text-sm font-bold text-bad">
            <span>{t('upd.oldFail', { msg: info.job.message })}</span>
            <button type="button" className="btn-link btn-link-tone" onClick={() => { rememberDismissed(info.job!.time); setDismissed(info.job!.time); }}>{t('upd.hide')}</button>
          </div>
        )}
        <div className="relative"><ErrorLine text={error} /></div>
      </section>

      <NotesCard notes={notes} log={log} logError={logError} current={info?.currentLabel} installedAt={info?.installedAt} />
      <HistoryCard refreshKey={info?.job?.time ?? 0} />
      {info && <OptionsCard info={info} onChange={setInfo} />}
    </div>
  );
}
