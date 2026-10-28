/** Following players: the button on a player's page and the list in the profile. */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { t, useI18n } from '../../i18n';
import { Button, ErrorLine, Section, ago, toast, fail } from '../../ui';

interface Follow { nick: string; createdAt: number }

const keyOf = (nick: string) => nick.trim().toLowerCase();

/** «Следить» on /player/<nick>: a notification when the nick joins a server. Nothing for guests. */
export function FollowButton({ nick }: { nick: string }) {
  useI18n();
  const { me } = useAuth();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!me) return;
    let alive = true;
    api<Follow[]>('/me/follows').then((l) => { if (alive) setOn(l.some((f) => keyOf(f.nick) === keyOf(nick))); }).catch(() => { if (alive) setOn(false); });
    return () => { alive = false; };
  }, [me, nick]);
  if (!me || on === null) return null;
  const flip = async () => {
    setBusy(true);
    try {
      await api(`/players/${encodeURIComponent(nick)}/follow`, on ? 'DELETE' : 'PUT');
      setOn(!on);
      toast(on ? t('d2.fo.t.off', { nick }) : t('d2.fo.t.on', { nick }));
    } catch (e) {
      fail(e);
    }
    setBusy(false);
  };
  return (
    <Button type="button" size="sm" variant={on ? 'outline' : 'soft'} loading={busy} aria-pressed={on} onClick={() => void flip()}>
      {on ? t('d2.fo.following') : t('d2.fo.follow')}
    </Button>
  );
}

/** Profile: the nicks I follow, each with a way to stop */
export function FollowsCard() {
  useI18n();
  const [list, setList] = useState<Follow[] | null>(null);
  const [error, setError] = useState('');
  const load = () => api<Follow[]>('/me/follows').then(setList).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const stop = async (nick: string) => {
    await api(`/players/${encodeURIComponent(nick)}/follow`, 'DELETE').catch((e: Error) => setError(e.message));
    void load();
  };
  return (
    <Section title={t('d2.fo.title')} description={t('d2.fo.desc')}>
      <ErrorLine text={error} />
      {list === null ? <div className="skeleton h-12 rounded-2xl" /> : list.length === 0 ? (
        <p className="font-semibold text-mute">{t('d2.fo.none')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((f) => (
            <li key={f.nick} className="flex flex-wrap items-center gap-2 py-2">
              <a href={`/player/${encodeURIComponent(f.nick)}`} className="min-w-0 flex-1 truncate font-extrabold hover:text-link">{f.nick}</a>
              <span className="text-xs font-semibold text-mute">{t('d2.an.since', { date: ago(f.createdAt) })}</span>
              <button type="button" className="btn btn-soft btn-xs" onClick={() => void stop(f.nick)}>{t('d2.fo.stop')}</button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
