/** Reviews of a server: the average with the spread of stars, the reviews, and the visitor's own one to write or edit. */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Button, ErrorLine, UserAvatar, ago, plural, toast, num } from '../../ui';

export interface Review { id: number; author: string; avatarUrl: string | null; stars: number; text: string; hidden: boolean; createdAt: number; updatedAt: number }
interface Reviews { avg: number | null; count: number; dist: number[]; items: Review[]; mine: Review | null }

export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="rv-stars" role="img" aria-label={`${value} из 5`} style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= Math.round(value) ? 'on' : ''} aria-hidden>★</span>)}
    </span>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <span className="rv-pick" role="radiogroup" aria-label="Оценка" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} из 5`}
          className={n <= shown ? 'on' : ''}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(n)}
        >★</button>
      ))}
    </span>
  );
}

export default function ServerReviews({ serverId }: { serverId: number }) {
  const { me } = useAuth();
  const [r, setR] = useState<Reviews | null>(null);
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => api<Reviews>(`/servers/${serverId}/reviews`).then((v) => { setR(v); setStars(v.mine?.stars ?? 0); setText(v.mine?.text ?? ''); }).catch(() => undefined);
  useEffect(() => { void load(); }, [serverId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stars) return setError('Поставьте оценку: от 1 до 5 звёзд');
    setBusy(true);
    setError('');
    await api(`/servers/${serverId}/reviews`, 'PUT', { stars, text })
      .then(() => { toast(r?.mine ? 'Отзыв обновлён' : 'Спасибо за отзыв!'); setEditing(false); void load(); })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };
  const remove = async () => {
    await api(`/servers/${serverId}/reviews/mine`, 'DELETE').then(() => { toast('Отзыв удалён'); setEditing(false); void load(); }).catch((err: Error) => setError(err.message));
  };

  if (!r) return <div className="skeleton h-28 rounded-2xl" aria-busy="true" />;
  const formOpen = !!me && (editing || !r.mine);
  const others = r.items.filter((x) => x.id !== r.mine?.id);
  return (
    <div className="rv">
      <div className="rv-score">
        <div className="text-center">
          <div className="rv-avg">{r.avg != null ? num(r.avg) : '—'}</div>
          <Stars value={r.avg ?? 0} size={18} />
          <div className="mt-1 text-sm font-bold text-mute">{r.count} {plural(r.count, ['отзыв', 'отзыва', 'отзывов'])}</div>
        </div>
        <ul className="rv-dist" aria-label="Оценки">
          {[5, 4, 3, 2, 1].map((n) => (
            <li key={n}>
              <span className="w-3 text-right">{n}</span>
              <span className="rv-dist-bar"><span style={{ width: `${r.count ? (r.dist[n - 1] / r.count) * 100 : 0}%` }} /></span>
              <span className="w-6 text-right tabular-nums">{r.dist[n - 1]}</span>
            </li>
          ))}
        </ul>
      </div>

      {r.mine && !editing && (
        <div className="rv-item is-mine">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-extrabold">Ваш отзыв</span>
            <Stars value={r.mine.stars} />
            {r.mine.hidden && <span className="pill pill-mute">скрыт модератором</span>}
            <span className="ml-auto flex gap-3">
              <button type="button" className="btn-link btn-xs" onClick={() => setEditing(true)}>Изменить</button>
              <button type="button" className="btn-link btn-link-danger btn-xs" onClick={() => void remove()}>Удалить</button>
            </span>
          </div>
          {r.mine.text && <p className="mt-1 whitespace-pre-line font-semibold">{r.mine.text}</p>}
        </div>
      )}

      {formOpen && (
        <form onSubmit={submit} className="rv-form">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-extrabold">{r.mine ? 'Изменить отзыв' : 'Как вам сервер?'}</span>
            <StarPicker value={stars} onChange={setStars} />
          </div>
          <textarea className="input min-h-[5rem]" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Что понравилось, что стоит улучшить (необязательно)" aria-label="Текст отзыва" />
          <ErrorLine text={error} />
          <div className="flex justify-end gap-2">
            {editing && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Отмена</button>}
            <Button loading={busy} className="btn-sm">{r.mine ? 'Сохранить' : 'Оставить отзыв'}</Button>
          </div>
        </form>
      )}
      {!me && <p className="text-sm font-semibold text-mute"><a href="/login" className="font-extrabold text-link hover:underline">Войдите</a>, чтобы оставить отзыв.</p>}

      {others.length > 0 && (
        <ul className="grid gap-2.5">
          {others.map((x) => (
            <li key={x.id} className="rv-item">
              <div className="flex flex-wrap items-center gap-2">
                <UserAvatar name={x.author} url={x.avatarUrl} size={28} />
                <span className="font-extrabold">{x.author}</span>
                <Stars value={x.stars} />
                <span className="ml-auto text-xs font-bold text-mute">{ago(x.updatedAt)}</span>
              </div>
              {x.text && <p className="mt-1.5 whitespace-pre-line font-semibold">{x.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
