import { useState } from 'react';
import { api } from '../api';
import { IconAlert, IconCheck, IconClock } from '../components/GameNewsIcons';
import { t, useI18n } from '../i18n';
import { errText } from '../ui';

interface Check { id: string; ok: boolean | null; text: string; fix?: string }
interface Attempt { ts: number; name: string; status: 'sent' | 'empty' | 'denied' | 'rate'; why: string }
interface Result { checks: Check[]; attempts: Attempt[] }

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** «Проверить запись из Discord»: what the panel can see about the way of a line from the chat channel into the game */
export function SayCheck() {
  useI18n();
  const [r, setR] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true);
    setError('');
    try { setR(await api<Result>('/game-news/say-check')); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => void run()}>{t('gn.sy.check')}</button>
        <span className="text-sm font-semibold text-mute">{t('gn.sy.note')}</span>
      </div>
      {error && <p className="text-sm font-semibold text-bad">{error}</p>}
      {r && (
        <div className="space-y-2 rounded-xl border border-line px-4 py-3">
          <ul className="space-y-2">
            {r.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2.5">
                <span aria-hidden className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${c.ok === true ? 'bg-okbg text-ok' : c.ok === false ? 'bg-badbg text-bad' : 'bg-soft text-mute'}`}>
                  {c.ok === true ? <IconCheck size={14} /> : c.ok === false ? <IconAlert size={14} /> : <IconClock size={14} />}
                </span>
                <span className="min-w-0 text-sm">
                  <span className="block font-bold">{c.text}</span>
                  {c.fix && <span className="block font-semibold text-mute">{c.fix}</span>}
                </span>
              </li>
            ))}
          </ul>
          {r.attempts.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-extrabold text-mute">{t('gn.sy.last')}</div>
              <ul className="space-y-0.5 text-sm">
                {r.attempts.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <time className="tabular-nums text-mute">{clock(a.ts)}</time>
                    <span className="font-bold">{a.name}</span>
                    <span className={a.status === 'sent' ? 'pill pill-ok' : a.status === 'empty' ? 'pill pill-mute' : 'pill pill-warn'}>{t(`gn.sy.st.${a.status}` as 'gn.sy.st.sent')}</span>
                    <span className="min-w-0 truncate font-semibold text-mute">{a.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
