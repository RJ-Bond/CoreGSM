/** Settings → Updates: version check, changelog, update and rollback through the host updater. */
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { api, type Changelog, type UpdateInfo } from '../../api';
import { confirmDialog } from '../../confirm';
import { ago, ErrorLine, IconArrowUp, IconCheck, Section, Spinner, usePoll } from '../../ui';

const short = (v: string | null) => (v ? v.slice(0, 7) : '–');

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

  useEffect(() => {
    api<Changelog>('/update/changelog')
      .then((r) => { setLog(r); setLogError(r.error ?? ''); })
      .catch((e: Error) => setLogError(e.message));
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
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!(await confirmDialog({ title: 'Обновить панель?', text: 'Она будет недоступна 1-3 минуты, данные и настройки сохранятся.', confirmLabel: 'Обновить' }))) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<UpdateInfo>('/update/apply', 'POST');
      setInfo(r);
      setPct(null);
      setFinished(null);
      setWaiting({ since: Date.now(), baseTime: r.job?.time ?? null, kind: 'update' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rollback = async () => {
    const ok = await confirmDialog({
      title: 'Откатить к предыдущей версии?',
      text: 'Будут восстановлены предыдущая версия панели и копия базы данных, сделанная перед последним обновлением. Всё, что изменилось после обновления (новые серверы, новости, пользователи), будет потеряно. Панель будет недоступна 1-3 минуты.',
      confirmLabel: 'Откатить',
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
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rollingBack = (waiting?.kind ?? finished) === 'rollback';
  // an old failure matters only while an update is still pending; a manual install that succeeded makes it moot
  const [dismissed, setDismissed] = useState<number>(readDismissed);
  const showOldFailure = !running && !error && info?.job?.state === 'error' && !!info.available && info.job.time !== dismissed;
  const stuck = !!waiting && Date.now() - waiting.since > 60_000 && !!info?.pending;

  const state: 'running' | 'available' | 'latest' | 'unknown' = running || finished ? 'running' : info?.available ? 'available' : info?.latest ? 'latest' : 'unknown';
  const lastChecked = info?.checkedAt ?? null;

  return (
    <div className="space-y-5">
      <section
        aria-live="polite"
        className={`relative overflow-hidden rounded-[26px] p-6 sm:p-7 ${
          state === 'available'
            ? 'update-hero text-white'
            : state === 'running'
              ? 'update-hero update-hero-run text-white'
              : 'panel'
        }`}
      >
        {(state === 'available' || state === 'running') && <span aria-hidden className="pointer-events-none absolute -right-14 -top-14 h-56 w-56 rounded-full bg-white/15" />}
        <div className="relative flex flex-wrap items-start gap-4">
          <span
            aria-hidden
            className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${
              state === 'available' || state === 'running' ? 'bg-white/20 text-white' : state === 'latest' ? 'bg-okbg text-ok' : 'bg-soft text-mute'
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
            <h2 className="text-2xl font-extrabold leading-tight" style={{ letterSpacing: '-0.02em' }}>
              {state === 'running' ? (rollingBack ? 'Откат к предыдущей версии' : 'Идёт обновление')
                : state === 'available' ? 'Доступно обновление'
                : state === 'latest' ? 'Установлена последняя версия'
                : 'Проверка обновлений'}
            </h2>
            <p className={`mt-1 font-semibold ${state === 'available' || state === 'running' ? 'text-white/90' : 'text-mute'}`}>
              {state === 'running'
                ? (finished ? 'Готово! Панель обновится сама' : offline ? 'Панель перезапускается…' : info?.job?.state === 'running' && info.job.message ? info.job.message : rollingBack ? 'Откат к предыдущей версии…' : 'Запрос отправлен серверу…')
                : state === 'available'
                  ? 'Новая сборка уже в репозитории. Данные и настройки сохранятся, панель будет недоступна 1-3 минуты.'
                  : state === 'latest'
                    ? `Всё свежее${lastChecked ? `, проверено ${ago(lastChecked)}` : ''}.`
                    : 'Узнаём, есть ли новая версия…'}
            </p>

            <dl className="mt-4 flex flex-wrap items-center gap-2 text-sm font-bold">
              <div className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 ${state === 'available' || state === 'running' ? 'bg-white/20' : 'bg-soft'}`}>
                <dt className={state === 'available' || state === 'running' ? 'text-white/85' : 'text-mute'}>Установлена</dt>
                <dd className="font-mono">{short(info?.current ?? null)}</dd>
              </div>
              {state === 'available' && <span aria-hidden className="text-lg font-black text-white/90">→</span>}
              <div className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 ${state === 'available' ? 'bg-white text-ink' : state === 'running' ? 'bg-white/20' : 'bg-soft'}`}>
                <dt className={state === 'available' ? 'text-mute' : state === 'running' ? 'text-white/85' : 'text-mute'}>В репозитории</dt>
                <dd className="font-mono">{short(info?.latest ?? null)}</dd>
              </div>
            </dl>
          </div>
        </div>

        {state === 'running' && (
          <div className="relative mt-5 flex items-center gap-3">
            <div
              className={`update-progress min-w-0 flex-1 ${pct != null ? 'det' : ''}`}
              role="progressbar"
              aria-label={rollingBack ? 'Ход отката' : 'Ход обновления'}
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
        )}

        <div className="relative mt-5 flex flex-wrap items-center gap-2.5">
          {state === 'available' && (
            <>
              <button className="btn-on-grad btn-lg" onClick={apply} disabled={busy || running || !info?.canApply}>
                {busy ? 'Отправляю…' : 'Обновить сейчас'}
              </button>
              <a className="btn-ghost-on-grad" href="#update-changes" onClick={(e) => { e.preventDefault(); document.getElementById('update-changes')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Что нового</a>
            </>
          )}
          {(state === 'latest' || state === 'unknown') && (
            <button className="btn" onClick={check} disabled={busy || running}>{busy ? 'Проверяю…' : 'Проверить обновления'}</button>
          )}
          {state === 'available' && (
            <button className="btn-ghost-on-grad" onClick={check} disabled={busy || running}>Проверить ещё раз</button>
          )}
          {info?.canRollback && state !== 'running' && (
            <button className={`${state === 'available' ? 'btn-ghost-on-grad' : 'btn btn-soft'} sm:ml-auto`} onClick={() => void rollback()} disabled={busy || running}>Откатить к предыдущей</button>
          )}
        </div>

        {state === 'available' && info && !info.canApply && (
          <p className="relative mt-3 rounded-2xl bg-black/15 px-4 py-2.5 text-sm font-bold">
            Кнопка недоступна на этом сервере. Обновляйте командой <span className="font-mono">sudo coregsm update</span>.
          </p>
        )}
        {state !== 'available' && info && !info.canApply && state !== 'running' && (
          <p className="relative mt-3 text-sm font-semibold text-mute">Кнопка обновления недоступна на этом сервере. Обновляйте командой <span className="font-mono">sudo coregsm update</span>.</p>
        )}
        {stuck && (
          <p className="relative mt-3 rounded-2xl bg-badbg px-4 py-2.5 text-sm font-bold text-bad">
            Сервер не взял запрос в работу. Проверьте на сервере: <span className="font-mono">systemctl status coregsm-update.path</span> или {rollingBack ? 'выполните откат вручную' : <>обновите командой <span className="font-mono">sudo coregsm update</span></>}.
          </p>
        )}
        {info?.error && !running && <p className="relative mt-3 text-sm font-semibold text-mute">{info.error}</p>}
        {showOldFailure && info?.job && (
          <div className="relative mt-3 flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-badbg px-4 py-2.5 text-sm font-bold text-bad">
            <span>Прошлая попытка обновления не удалась. {info.job.message}</span>
            <button type="button" className="btn-link btn-link-tone" onClick={() => { rememberDismissed(info.job!.time); setDismissed(info.job!.time); }}>Скрыть</button>
          </div>
        )}
        <div className="relative"><ErrorLine text={error} /></div>
      </section>

      <Section id="update-changes" title="Что нового" className="scroll-mt-24">

        {!log && !logError && <div className="skeleton h-24 rounded-2xl" />}
        {logError && <p className="text-sm font-semibold text-mute">Не удалось получить список изменений: {logError}</p>}
        {log && log.items.length === 0 && !logError && <p className="font-semibold text-mute">Список изменений пуст.</p>}
        {log && log.items.length > 0 && (
          <ul className="divide-y divide-line">
            {log.items.map((c) => (
              <li key={c.sha} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5">
                <a href={/^https?:\/\//i.test(c.url) ? c.url : undefined} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 basis-60 wrap-break-word font-bold hover:text-link">{c.title}</a>
                <span className="font-mono text-sm font-semibold text-mute">{c.sha.slice(0, 7)}</span>
                <span className="text-sm font-semibold text-mute">{ago(typeof c.date === 'number' ? c.date : Date.parse(String(c.date)) || null)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
