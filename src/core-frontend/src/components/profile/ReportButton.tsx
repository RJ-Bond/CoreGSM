/** «Пожаловаться» on a player's page: a reason and a few words go to the moderators' queue. */
import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { t, useI18n, type TKey } from '../../i18n';
import { Button, ErrorLine, Field, Modal, toast, errText } from '../../ui';

export const REASONS: readonly { id: 'cheating' | 'abuse' | 'griefing' | 'other'; label: TKey }[] = [
  { id: 'cheating', label: 'd2.rb.r.cheating' },
  { id: 'abuse', label: 'd2.rb.r.abuse' },
  { id: 'griefing', label: 'd2.rb.r.griefing' },
  { id: 'other', label: 'd2.ac.r.other' },
];

export function ReportButton({ nick }: { nick: string }) {
  useI18n();
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
      toast(t('d2.rb.t.sent'));
      setOpen(false);
      setText('');
    } catch (err) {
      setError(errText(err));
    }
    setBusy(false);
  };

  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>⚑ {t('d2.rb.report')}</Button>
      {open && (
        <Modal title={t('d2.rb.title', { nick })} onClose={() => setOpen(false)}>
          <form onSubmit={send} className="space-y-3.5">
            <fieldset className="space-y-1.5">
              <legend className="label">{t('d2.rb.reason')}</legend>
              {REASONS.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-center gap-2.5 font-bold">
                  <input type="radio" name="report-reason" className="h-4 w-4 accent-brand" checked={reason === r.id} onChange={() => setReason(r.id)} />
                  {t(r.label)}
                </label>
              ))}
            </fieldset>
            <Field label={t('d2.rb.what')}>
              <textarea className="input min-h-24" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('d2.rb.ph')} />
            </Field>
            <p className="text-sm font-semibold text-mute">{t('d2.rb.note')}</p>
            <ErrorLine text={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
              <Button type="submit" loading={busy}>{t('d2.gal.send')}</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
