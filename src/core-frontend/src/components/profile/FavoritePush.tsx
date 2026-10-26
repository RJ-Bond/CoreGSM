/** Profile → push for favourite servers: which events of the starred servers reach the devices. */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { t, useI18n, type TKey } from '../../i18n';
import { ErrorLine, Section, Switch } from '../../ui';

interface Prefs { online: boolean; freeSlot: boolean; down: boolean; devices: number; favorites: number }
type Key = 'online' | 'freeSlot' | 'down';

const ROWS: { key: Key; title: TKey; hint: TKey }[] = [
  { key: 'online', title: 'favpush.online', hint: 'favpush.online.h' },
  { key: 'freeSlot', title: 'favpush.freeSlot', hint: 'favpush.freeSlot.h' },
  { key: 'down', title: 'favpush.down', hint: 'favpush.down.h' },
];

export function FavoritePushCard() {
  useI18n();
  const [p, setP] = useState<Prefs | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<Prefs>('/me/favorite-push').then(setP).catch((e: Error) => setError(e.message)); }, []);
  const set = (key: Key, v: boolean) => {
    if (!p) return;
    setP({ ...p, [key]: v });
    api<Prefs>('/me/favorite-push', 'PUT', { [key]: v }).then(setP).catch((e: Error) => { setP(p); setError(e.message); });
  };
  return (
    <Section title={t('favpush.title')} description={t('favpush.desc')}>
      {p && (
        <>
          {p.devices === 0 && <p className="text-sm font-semibold text-warn">{t('favpush.noDevices')}</p>}
          {p.favorites === 0 && <p className="text-sm font-semibold text-mute">{t('favpush.noFavs')}</p>}
          <ul className="space-y-3">
            {ROWS.map((r) => (
              <li key={r.key}>
                <label className="flex cursor-pointer items-start gap-3">
                  <Switch checked={p[r.key]} onChange={(v) => set(r.key, v)} />
                  <span><span className="block font-extrabold">{t(r.title)}</span><span className="block text-sm font-semibold text-mute">{t(r.hint)}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <ErrorLine text={error} />
    </Section>
  );
}
