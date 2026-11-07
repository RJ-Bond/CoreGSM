import { useState } from 'react';
import { api } from '../api';
import { FoldCard } from '../components/GameNewsParts';
import { t, useI18n } from '../i18n';
import { ScopeNote, useScope } from './GameNewsScope';
import { Field, SaveBadge, errText, toast, useAutosave, usePoll } from '../ui';

interface Job { serverId: number; serverName: string; runAt: number; by: string; source: string; state: string; left: number }
interface Texts { announce: string; now: string; cancel: string }
interface State { jobs: Job[]; texts: Texts; servers: { id: number; name: string }[] }

const PRESETS = ['1m', '5m', '10m', '30m', '1h'];

/** «4:59» / «1:02:03» */
function clock(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
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
  // the seconds left are counted from the moment of the answer, so the clock moves between polls
  const [at, setAt] = useState(Date.now());
  const [, tick] = useState(0);

  const load = () => api<State>(`/game-news/restart${sc.q}`).then((d) => {
    setSt(d); setAt(Date.now());
    setTexts((x) => x ?? d.texts); setSaved((x) => x ?? d.texts);
    setServer((s) => s || d.servers[0]?.id || 0);
  }).catch(() => undefined);
  usePoll(() => { tick((n) => n + 1); return load(); }, 3000);

  const auto = useAutosave({
    value: texts ?? { announce: '', now: '', cancel: '' },
    saved: saved ?? { announce: '', now: '', cancel: '' },
    delay: 900,
    validate: (v) => (v.announce.trim() && v.now.trim() && v.cancel.trim() ? '' : t('gn.rr.empty')),
    save: async (v) => { await api(`/game-news/restart-texts${sc.q}`, 'PUT', v); setSaved(v); sc.changed(); },
  });

  if (!st || st.servers.length === 0) return null;
  const start = async () => {
    setBusy(true);
    try { await api('/game-news/restart', 'POST', { serverId: server, time }); toast(t('gn.rr.started'), 'ok'); await load(); } catch (e) { toast(errText(e as Error), 'err'); } finally { setBusy(false); }
  };
  const cancel = async (id: number) => {
    try { await api(`/game-news/restart/${id}`, 'DELETE'); await load(); } catch (e) { toast(errText(e as Error), 'err'); }
  };
  const elapsed = Math.round((Date.now() - at) / 1000);

  return (
    <FoldCard id="srvrestart" title={t('gn.rr.title')} summary={t('gn.rr.sum')} on={st.jobs.some((j) => j.state === 'counting')}>
      <p className="text-sm font-semibold text-mute">{t('gn.rr.note')}</p>

      {st.jobs.filter((j) => j.state !== 'sent' || j.left > -60).map((j) => (
        <div key={j.serverId} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2">
          <span className="font-extrabold">{j.serverName}</span>
          <span className="pill pill-warn">{j.state === 'counting' ? clock(j.left - elapsed) : j.state === 'due' ? t('gn.rr.due') : t('gn.rr.sent')}</span>
          <span className="text-sm font-semibold text-mute">{t('gn.rr.by', { by: j.by || '—', src: j.source })}</span>
          {j.state !== 'sent' && <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => void cancel(j.serverId)}>{t('gn.rr.cancel')}</button>}
        </div>
      ))}

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
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => <button key={p} type="button" className="chip-filter" onClick={() => setTime(p)}>{p}</button>)}
      </div>

      {texts && (
        <div className="space-y-3">
          <h4 className="font-extrabold">{t('gn.rr.words')}</h4>
          <ScopeNote part="restart" />
          <Field label={t('gn.rr.announce')}>
            <input className="input" value={texts.announce} maxLength={300} onChange={(e) => setTexts({ ...texts, announce: e.target.value })} />
          </Field>
          <Field label={t('gn.rr.now')}>
            <input className="input" value={texts.now} maxLength={300} onChange={(e) => setTexts({ ...texts, now: e.target.value })} />
          </Field>
          <Field label={t('gn.rr.cancelText')}>
            <input className="input" value={texts.cancel} maxLength={300} onChange={(e) => setTexts({ ...texts, cancel: e.target.value })} />
          </Field>
          <SaveBadge status={auto.status} error={auto.error} retry={auto.retry} />
        </div>
      )}
    </FoldCard>
  );
}
