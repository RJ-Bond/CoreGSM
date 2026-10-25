/** Following players: the button on a player's page and the list in the profile. */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Button, ErrorLine, Section, ago, toast } from '../../ui';

interface Follow { nick: string; createdAt: number }

const keyOf = (nick: string) => nick.trim().toLowerCase();

/** «Следить» on /player/<nick>: a notification when the nick joins a server. Nothing for guests. */
export function FollowButton({ nick }: { nick: string }) {
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
      toast(on ? `Больше не следим за ${nick}` : `Сообщим, когда ${nick} зайдёт на сервер`);
    } catch (e) {
      toast((e as Error).message, 'err');
    }
    setBusy(false);
  };
  return (
    <Button type="button" size="sm" variant={on ? 'outline' : 'soft'} loading={busy} aria-pressed={on} onClick={() => void flip()}>
      {on ? '★ Вы следите' : '☆ Следить'}
    </Button>
  );
}

/** Profile: the nicks I follow, each with a way to stop */
export function FollowsCard() {
  const [list, setList] = useState<Follow[] | null>(null);
  const [error, setError] = useState('');
  const load = () => api<Follow[]>('/me/follows').then(setList).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const stop = async (nick: string) => {
    await api(`/players/${encodeURIComponent(nick)}/follow`, 'DELETE').catch((e: Error) => setError(e.message));
    void load();
  };
  return (
    <Section title="Слежу за игроками" description="Сообщим в панели, в Discord и на устройстве, когда эти игроки заходят на сервер. Не чаще раза в 30 минут на игрока.">
      <ErrorLine text={error} />
      {list === null ? <div className="skeleton h-12 rounded-2xl" /> : list.length === 0 ? (
        <p className="font-semibold text-mute">Пока никого. Откройте страницу игрока и нажмите «Следить».</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((f) => (
            <li key={f.nick} className="flex flex-wrap items-center gap-2 py-2">
              <a href={`/player/${encodeURIComponent(f.nick)}`} className="min-w-0 flex-1 truncate font-extrabold hover:text-link">{f.nick}</a>
              <span className="text-xs font-semibold text-mute">с {ago(f.createdAt)}</span>
              <button type="button" className="btn btn-soft btn-xs" onClick={() => void stop(f.nick)}>Перестать</button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
