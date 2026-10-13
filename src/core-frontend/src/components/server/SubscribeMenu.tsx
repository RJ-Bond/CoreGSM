import { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { t, type TKey } from '../../i18n';
import { Button, ErrorLine, IconBell, Modal, toast } from '../../ui';
import { SUB_KINDS, normalizeKinds, toggleKind, useSubscriptions, type SubKind, type Subscription } from '../../notifications';

const KIND_KEY: Record<SubKind, TKey> = { free_slot: 'sub.free_slot', back_online: 'sub.back_online', went_down: 'sub.went_down' };

/** the choice of kinds: checkboxes and, when there is no linked Discord, a note about where the messages go */
export function SubscribeForm({ kinds, onChange, discordLinked, idPrefix = 'sub' }: { kinds: SubKind[]; onChange: (k: SubKind[]) => void; discordLinked: boolean; idPrefix?: string }) {
  return (
    <div className="space-y-3">
      <p className="font-semibold text-mute">{t('sub.text')}</p>
      <ul className="space-y-1.5">
        {SUB_KINDS.map((k) => (
          <li key={k}>
            <label htmlFor={`${idPrefix}-${k}`} className="flex cursor-pointer items-center gap-3 rounded-2xl bg-soft px-4 py-3 font-extrabold max-sm:min-h-[48px]">
              <input id={`${idPrefix}-${k}`} type="checkbox" checked={kinds.includes(k)} onChange={() => onChange(toggleKind(kinds, k))} />
              {t(KIND_KEY[k])}
            </label>
          </li>
        ))}
      </ul>
      {!discordLinked && (
        <p className="rounded-2xl bg-soft px-4 py-2.5 text-sm font-semibold text-mute" role="note">
          {t('sub.discordNote')}.{' '}
          <a href="#/profile/security" className="font-extrabold text-link hover:underline">{t('sub.linkDiscord')}</a>
        </p>
      )}
    </div>
  );
}

/**
 * «Подписаться» in the server page header: opens a small dialog with the notification kinds.
 * Hidden for guests and when the backend has no subscriptions.
 */
export default function SubscribeMenu({ serverId, serverName }: { serverId: number; serverName: string }) {
  const { me } = useAuth();
  const subs = useSubscriptions(!!me);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SubKind[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!me || subs.unavailable || subs.list === null) return null;
  const current = normalizeKinds(subs.list.find((s) => s.serverId === serverId)?.kinds);
  const on = current.length > 0;

  const show = () => { setDraft(current); setError(''); setOpen(true); };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api<Subscription>(`/servers/${serverId}/subscription`, 'PUT', { kinds: draft });
      const kinds = normalizeKinds(r?.kinds ?? draft);
      subs.set({ serverId, kinds });
      toast(kinds.length ? t('sub.saved') : t('sub.off'));
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn-glass col-span-2 sm:col-auto" onClick={show} aria-haspopup="dialog" aria-label={`${on ? t('sub.buttonOn') : t('sub.button')}: ${serverName}`}>
        <IconBell size={18} />
        {on ? t('sub.buttonOn') : t('sub.button')}
      </button>
      {open && (
        <Modal title={t('sub.title')} onClose={() => setOpen(false)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <SubscribeForm kinds={draft} onChange={setDraft} discordLinked={!!me.discordName} />
            <ErrorLine text={error} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-soft" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
              <Button loading={busy}>{t('sub.save')}</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
