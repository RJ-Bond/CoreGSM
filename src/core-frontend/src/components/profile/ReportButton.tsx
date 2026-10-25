/** «Пожаловаться» on a player's page: a reason and a few words go to the moderators' queue. */
import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Button, ErrorLine, Field, Modal, toast } from '../../ui';

export const REASONS = [
  { id: 'cheating', label: 'Читы или нечестная игра' },
  { id: 'abuse', label: 'Оскорбления, токсичность' },
  { id: 'griefing', label: 'Грифинг, порча чужого' },
  { id: 'other', label: 'Другое' },
] as const;

export function ReportButton({ nick }: { nick: string }) {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]['id']>('cheating');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!me) return null;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/players/${encodeURIComponent(nick)}/report`, 'POST', { reason, text: text.trim() });
      toast('Жалоба отправлена модераторам. Ответ придёт в уведомления');
      setOpen(false);
      setText('');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>⚑ Пожаловаться</Button>
      {open && (
        <Modal title={`Жалоба на игрока ${nick}`} onClose={() => setOpen(false)}>
          <form onSubmit={send} className="space-y-3.5">
            <fieldset className="space-y-1.5">
              <legend className="label">Причина</legend>
              {REASONS.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-center gap-2.5 font-bold">
                  <input type="radio" name="report-reason" className="h-4 w-4 accent-brand" checked={reason === r.id} onChange={() => setReason(r.id)} />
                  {r.label}
                </label>
              ))}
            </fieldset>
            <Field label="Что произошло (необязательно)">
              <textarea className="input min-h-24" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Сервер, время, что именно сделал игрок" />
            </Field>
            <p className="text-sm font-semibold text-mute">Жалобу увидят только модераторы. Не больше 5 жалоб в сутки.</p>
            <ErrorLine text={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
              <Button type="submit" loading={busy}>Отправить</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
