import { useState } from 'react';
import { api } from '../api';
import { FoldCard, VarChips, soon } from '../components/GameNewsParts';
import { ChatLines } from '../components/NewsEditor';
import { t, useI18n } from '../i18n';
import { Switch } from '../components/Switch';
import { ScopeNote, useScope } from './GameNewsScope';
import { Field, SaveBadge, errText, toast, useAutosave, usePoll } from '../ui';

interface Job { serverId: number; serverName: string; runAt: number; by: string; source: string; state: string; left: number; total: number }
interface Texts { announce: string; now: string; cancel: string }
interface HistoryRow { id: number; serverName: string; startedAt: number; runAt: number; totalSec: number; by: string; source: string; outcome: 'counting' | 'done' | 'cancelled' | 'missed' | 'replaced'; finishedAt: number | null }
interface State { emptyNow: boolean; jobs: Job[]; texts: Texts; servers: { id: number; name: string }[]; history: HistoryRow[] }

const PRESETS = ['1m', '5m', '10m', '30m', '1h'];
const OUTCOME: Record<HistoryRow['outcome'], { text: 'gn.rr.o.counting' | 'gn.rr.o.done' | 'gn.rr.o.cancelled' | 'gn.rr.o.missed' | 'gn.rr.o.replaced'; cls: string }> = {
  counting: { text: 'gn.rr.o.counting', cls: 'pill pill-warn' },
  done: { text: 'gn.rr.o.done', cls: 'pill pill-ok' },
  cancelled: { text: 'gn.rr.o.cancelled', cls: 'pill pill-mute' },
  missed: { text: 'gn.rr.o.missed', cls: 'pill pill-warn' },
  replaced: { text: 'gn.rr.o.replaced', cls: 'pill pill-mute' },
};

/** «4:59» / «1:02:03» */
function clock(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
}

/** the time in the sample line of the preview (in the chat the panel says the real one) */
const SAMPLE_TIME = '5 минут';
const plain = (s: string) => s.replace(/[<>]/g, '');

/** the ring of the countdown: the part of the time that is left */
function Ring({ left, total, red }: { left: number; total: number; red: boolean }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const part = total > 0 ? Math.min(1, Math.max(0, left / total)) : 0;
  return (
    <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0" role="img" aria-label={clock(left)}>
      <circle cx="50" cy="50" r={r} fill="none" strokeWidth="8" className="stroke-line" />
      <circle
        cx="50" cy="50" r={r} fill="none" strokeWidth="8" strokeLinecap="round"
        stroke={red ? '#FF5555' : '#FFCC33'}
        strokeDasharray={c} strokeDashoffset={c * (1 - part)}
        transform="rotate(-90 50 50)" style={{ transition: 'stroke-dashoffset 1s linear' }}
      />
      <text x="50" y="56" textAnchor="middle" fontSize="20" fontWeight="800" fill="currentColor">{clock(left)}</text>
    </svg>
  );
}

/** A restart of a game server by a timer: the chat is told how long is left, then the plugin closes the server. */
export function ServerRestartCard() {
  useI18n();
  const sc = useScope();
  const [st, setSt] = useState<State | null>(null);
  const [server, setServer] = useState(0);
  const [time, setTime] = useState('5m');
  const [busy, setBusy] = useState(false);
  const [texts, setTexts] = useState<Texts | null>(null);
  const [saved, setSaved] = useState<Texts | null>(null);
  const [showLog, setShowLog] = useState(false);
  // the seconds left are counted from the moment of the answer, so the clock moves between polls
  const [at, setAt] = useState(Date.now());
  const [, tick] = useState(0);

  const load = () => api<State>(`/game-news/restart${sc.q}`).then((d) => {
    setSt(d); setAt(Date.now());
    setTexts((x) => x ?? d.texts); setSaved((x) => x ?? d.texts);
    setServer((s) => s || d.servers[0]?.id || 0);
  }).catch(() => undefined);
  usePoll(load, 3000);
  // the ring moves every second between the polls
  usePoll(() => { tick((n) => n + 1); }, 1000);

  const auto = useAutosave({
    value: texts ?? { announce: '', now: '', cancel: '' },
    saved: saved ?? { announce: '', now: '', cancel: '' },
    delay: 900,
    validate: (v) => (v.announce.trim() && v.now.trim() && v.cancel.trim() ? '' : t('gn.rr.empty')),
    save: async (v) => { await api(`/game-news/restart-texts${sc.q}`, 'PUT', v); setSaved(v); sc.changed(); },
  });

  if (!st || st.servers.length === 0) return null;
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok, 'ok'); await load(); } catch (e) { toast(errText(e as Error), 'err'); } finally { setBusy(false); }
  };
  const start = () => run(async () => {
    const r = await api<{ immediate: boolean }>('/game-news/restart', 'POST', { serverId: server, time });
    toast(r.immediate ? t('gn.rr.immediate') : t('gn.rr.started'), 'ok');
  }, undefined);
  const setEmpty = (v: boolean) => run(() => api('/game-news/restart-empty', 'PUT', { enabled: v }));
  const cancel = (id: number) => run(() => api(`/game-news/restart/${id}`, 'DELETE'));
  const postpone = (id: number, seconds: number) => run(() => api(`/game-news/restart/${id}/postpone`, 'POST', { seconds }), t('gn.rr.postponed'));
  const elapsed = Math.round((Date.now() - at) / 1000);
  const jobs = st.jobs.filter((j) => j.state !== 'sent' || j.left - elapsed > -60);
  const history = st.history;

  const announce = `<color=#FFCC33>${plain(texts?.announce ?? '').replace(/\{time\}/g, SAMPLE_TIME)}</color>`;
  const now = `<color=#FF5555>${plain(texts?.now ?? '')}</color>`;
  const cancelled = `<color=#5FD068>${plain(texts?.cancel ?? '')}</color>`;

  return (
    <FoldCard id="srvrestart" title={t('gn.rr.title')} summary={t('gn.rr.sum')} on={st.jobs.some((j) => j.state === 'counting')}>
      <p className="text-sm font-semibold text-mute">{t('gn.rr.note')}</p>

      {jobs.map((j) => {
        const left = j.state === 'counting' ? Math.max(0, j.left - elapsed) : 0;
        return (
          <div key={j.serverId} className="flex flex-wrap items-center gap-4 rounded-xl border border-line px-4 py-3">
            <Ring left={left} total={j.total} red={left <= 60} />
            <div className="min-w-0 flex-1 basis-56 space-y-1">
              <div className="wrap-break-word font-extrabold">{j.serverName}</div>
              <div className="text-sm font-semibold text-mute">
                {j.state === 'counting' ? t('gn.rr.at', { time: new Date(j.runAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : j.state === 'due' ? t('gn.rr.due') : t('gn.rr.sent')}
                {' · '}{t('gn.rr.by', { by: j.by || '—', src: j.source })}
              </div>
              {j.state !== 'sent' && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {[60, 300, 900].map((sec) => (
                    <button key={sec} type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => void postpone(j.serverId, sec)}>+{sec / 60} {t('gn.rr.min')}</button>
                  ))}
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void cancel(j.serverId)}>{t('gn.rr.cancel')}</button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-end gap-3">
        {st.servers.length > 1 && (
          <Field label={t('gn.rr.server')}>
            <select className="input" value={server} onChange={(e) => setServer(Number(e.target.value))}>
              {st.servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}
        <Field label={t('gn.rr.time')}>
          <input className="input w-32" value={time} maxLength={20} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <button type="button" className="btn" disabled={busy || !time.trim()} onClick={() => void start()}>{t('gn.rr.start')}</button>
      </div>
      <label className="flex items-start gap-3 font-bold">
        <Switch className="mt-0.5" checked={st.emptyNow} disabled={busy} onChange={(v) => void setEmpty(v)} />
        <span>
          {t('gn.rr.empty0')}
          <span className="block text-sm font-semibold text-mute">{t('gn.rr.empty0Note')}</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => <button key={p} type="button" className={`chip-filter ${time === p ? 'on' : ''}`} onClick={() => setTime(p)}>{p}</button>)}
      </div>

      {texts && (
        <div className="space-y-3">
          <h4 className="font-extrabold">{t('gn.rr.words')}</h4>
          <ScopeNote part="restart" />
          <Field label={t('gn.rr.announce')}>
            <input className="input" value={texts.announce} maxLength={300} onChange={(e) => setTexts({ ...texts, announce: e.target.value })} />
          </Field>
          <VarChips vars={[{ name: 'time', example: SAMPLE_TIME }]} onPick={(v) => setTexts({ ...texts, announce: `${texts.announce} ${v}`.trim() })} />
          <Field label={t('gn.rr.now')}>
            <input className="input" value={texts.now} maxLength={300} onChange={(e) => setTexts({ ...texts, now: e.target.value })} />
          </Field>
          <Field label={t('gn.rr.cancelText')}>
            <input className="input" value={texts.cancel} maxLength={300} onChange={(e) => setTexts({ ...texts, cancel: e.target.value })} />
          </Field>
          <ChatLines lines={[announce, now, cancelled]} />
          <SaveBadge status={auto.status} error={auto.error} retry={auto.retry} />
        </div>
      )}

      <div className="space-y-2">
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showLog} onClick={() => setShowLog((v) => !v)}>
          {showLog ? t('gn.rr.hideLog') : t('gn.rr.showLog', { n: history.length })}
        </button>
        {showLog && (history.length === 0
          ? <p className="text-sm font-semibold text-mute">{t('gn.rr.logEmpty')}</p>
          : (
            <ul className="divide-y divide-line">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className={OUTCOME[h.outcome].cls}>{t(OUTCOME[h.outcome].text)}</span>
                  <span className="wrap-break-word font-bold">{h.serverName}</span>
                  <span className="font-semibold text-mute">{soon(h.startedAt)} · {t('gn.rr.by', { by: h.by || '—', src: h.source })}</span>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </FoldCard>
  );
}
