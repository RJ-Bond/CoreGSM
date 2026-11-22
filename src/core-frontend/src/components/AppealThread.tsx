import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';
import { ErrorLine, errText, fmtDateTime } from '../ui';

interface Msg { id: number; at: number; side: 'staff' | 'player'; author: string; text: string }
interface Thread { appeal: { id: number; nick: string; status: string; canReply: boolean }; messages: Msg[] }

/** the conversation under an appeal: the staff asks, the signed-in author answers; closed with the decision */
export default function AppealThread({ id, onSent }: { id: number; onSent?: () => void }) {
  useI18n();
  const [th, setTh] = useState<Thread | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(() => api<Thread>(`/bans/appeals/${id}/messages`).then((r) => { setTh(r); setError(''); }).catch((e: unknown) => setError(errText(e))), [id]);
  useEffect(() => { void load(); }, [load]);
  const count = th?.messages.length ?? 0;
  useEffect(() => { if (count > 0) end.current?.scrollIntoView?.({ block: 'nearest' }); }, [count]);

  const send = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api(`/bans/appeals/${id}/messages`, 'POST', { text: text.trim() });
      setText('');
      await load();
      onSent?.();
    } catch (err) {
      setError(errText(err));
    }
    setBusy(false);
  };

  return (
    <div className="ap-thread" data-testid="appeal-thread">
      <ErrorLine text={error} />
      {th && th.messages.length === 0 && <p className="ap-none">{t('bans.thread.none')}</p>}
      {th && th.messages.length > 0 && (
        <ul className="ap-msgs" aria-label={t('bans.thread.title')}>
          {th.messages.map((m) => (
            <li key={m.id} className={`ap-msg ap-${m.side}`}>
              <div className="ap-who"><b>{m.author}</b> <span>{m.side === 'staff' ? t('bans.thread.staff') : t('bans.thread.player')}</span> <time dateTime={new Date(m.at).toISOString()}>{fmtDateTime(m.at)}</time></div>
              <p>{m.text}</p>
            </li>
          ))}
          <div ref={end} />
        </ul>
      )}
      {th && !th.appeal.canReply && <p className="ap-closed">{t('bans.thread.closed')}</p>}
      {th?.appeal.canReply && (
        <form className="ap-form" onSubmit={(e) => void send(e)}>
          <textarea className="input" rows={2} value={text} maxLength={1000} placeholder={t('bans.thread.placeholder')} aria-label={t('bans.thread.placeholder')} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-sm" disabled={busy || !text.trim()}>{t('bans.thread.send')}</button>
        </form>
      )}
    </div>
  );
}
