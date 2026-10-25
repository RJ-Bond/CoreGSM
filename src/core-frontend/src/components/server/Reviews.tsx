/** Reviews of a server: the average with the spread of stars, the reviews, and the visitor's own one to write or edit. */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Button, ErrorLine, UserAvatar, ago, plural, toast, num } from '../../ui';

export interface Review { id: number; author: string; avatarUrl: string | null; stars: number; text: string; hidden: boolean; createdAt: number; updatedAt: number; votes?: number; voted?: boolean; reply?: string | null; replyAt?: number | null }
interface Reviews { avg: number | null; count: number; dist: number[]; items: Review[]; mine: Review | null }

/** `exact`: the stars are filled in parts (4.3 lights the fifth star by a third); otherwise the value is rounded */
export function Stars({ value, size = 16, exact = false }: { value: number; size?: number; exact?: boolean }) {
  return (
    <span className="rv-stars" role="img" aria-label={`${value} из 5`} style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const f = exact ? Math.min(1, Math.max(0, value - (n - 1))) : n <= Math.round(value) ? 1 : 0;
        return <span key={n} className={f >= 1 ? 'on' : f > 0 ? 'fr' : ''} style={f > 0 && f < 1 ? { ['--f' as string]: f } : undefined} aria-hidden>★</span>;
      })}
    </span>
  );
}

const WORDS = ['', 'Ужасно', 'Плохо', 'Нормально', 'Хорошо', 'Отлично'];
type Sort = 'new' | 'useful' | 'high' | 'low';
const SORTS: [Sort, string][] = [['new', 'Новые'], ['useful', 'Полезные'], ['high', 'Высокие'], ['low', 'Низкие']];

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  const [pops, setPops] = useState(0);
  const shown = hover || value;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3">
      <span className="rv-pick" role="radiogroup" aria-label="Оценка" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={`${n}-${n <= value ? pops : 0}`}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} из 5`}
            className={`${n <= shown ? 'on' : ''} ${n <= value && pops > 0 ? 'is-pop' : ''}`}
            style={{ ['--i' as string]: n }}
            onMouseEnter={() => setHover(n)}
            onClick={() => { setPops((k) => k + 1); onChange(n); }}
          >★</button>
        ))}
      </span>
      <span className="rv-word" aria-live="polite">{WORDS[shown]}</span>
    </span>
  );
}

export default function ServerReviews({ serverId }: { serverId: number }) {
  const { me, isAdmin } = useAuth();
  const canReply = isAdmin || !!me?.perms?.includes('servers');
  const [sort, setSort] = useState<Sort>('new');
  const [starFilter, setStarFilter] = useState(0);
  const [replyFor, setReplyFor] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [r, setR] = useState<Reviews | null>(null);
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  // with no reviews at all the form stays folded behind one button instead of filling the block
  const [composing, setComposing] = useState(false);
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

  const vote = async (x: Review) => {
    if (!me) return;
    const was = !!x.voted;
    const res = await api<{ votes: number; voted: boolean }>(`/reviews/${x.id}/vote`, was ? 'DELETE' : 'PUT').catch((err: Error) => { toast(err.message, 'err'); return null; });
    if (res) setR((cur) => (cur ? { ...cur, items: cur.items.map((i) => (i.id === x.id ? { ...i, votes: res.votes, voted: res.voted } : i)) } : cur));
  };
  const saveReply = async (x: Review) => {
    const res = await api<{ reply: string | null }>(`/reviews/${x.id}/reply`, 'PUT', { text: replyText }).catch((err: Error) => { toast(err.message, 'err'); return null; });
    if (!res) return;
    setReplyFor(null);
    setR((cur) => (cur ? { ...cur, items: cur.items.map((i) => (i.id === x.id ? { ...i, reply: res.reply, replyAt: res.reply ? Date.now() : null } : i)) } : cur));
  };

  if (!r) return <div className="skeleton h-28 rounded-2xl" aria-busy="true" />;
  const empty = r.count === 0;
  const formOpen = !!me && (editing || (!r.mine && (!empty || composing)));
  const recommend = r.count ? Math.round(((r.dist[3] + r.dist[4]) / r.count) * 100) : 0;
  const filtered = r.items.filter((x) => x.id !== r.mine?.id && (!starFilter || x.stars === starFilter));
  const others = [...filtered].sort((a, b) => (sort === 'useful' ? (b.votes ?? 0) - (a.votes ?? 0) || b.updatedAt - a.updatedAt : sort === 'high' ? b.stars - a.stars || b.updatedAt - a.updatedAt : sort === 'low' ? a.stars - b.stars || b.updatedAt - a.updatedAt : b.updatedAt - a.updatedAt));
  return (
    <div className="rv">
      {empty && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="rv-none">Отзывов пока нет{me ? ': станьте первым.' : '.'}</p>
          {me && !r.mine && !formOpen && <button type="button" className="btn btn-soft btn-sm" onClick={() => setComposing(true)}>Оставить отзыв</button>}
        </div>
      )}
      {!empty && <div className="rv-score">
        <div className="text-center">
          <div className="rv-avg">{r.avg != null ? num(r.avg) : '—'}</div>
          <Stars value={r.avg ?? 0} size={22} exact />
          <div className="mt-1 text-sm font-bold text-mute">{r.count} {plural(r.count, ['отзыв', 'отзыва', 'отзывов'])}</div>
          <div className="rv-reco" title="Оценки 4 и 5">{recommend}% рекомендуют</div>
        </div>
        <ul className="rv-dist" aria-label="Оценки">
          {[5, 4, 3, 2, 1].map((n) => (
            <li key={n}>
              <button type="button" className={`rv-dist-row ${starFilter === n ? 'is-on' : ''}`} aria-pressed={starFilter === n} disabled={!r.dist[n - 1]} title={starFilter === n ? 'Показать все отзывы' : `Только отзывы на ${n} из 5`} onClick={() => setStarFilter(starFilter === n ? 0 : n)}>
                <span className="w-3 text-right">{n}</span>
                <span className="rv-dist-bar"><span style={{ width: `${r.count ? (r.dist[n - 1] / r.count) * 100 : 0}%` }} /></span>
                <span className="w-6 text-right tabular-nums">{r.dist[n - 1]}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>}

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
          <textarea className="input min-h-20" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Что понравилось, что стоит улучшить (необязательно)" aria-label="Текст отзыва" />
          <ErrorLine text={error} />
          <div className="flex justify-end gap-2">
            {(editing || (composing && empty)) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setComposing(false); }}>Отмена</button>}
            <Button loading={busy} className="btn-sm">{r.mine ? 'Сохранить' : 'Оставить отзыв'}</Button>
          </div>
        </form>
      )}
      {!me && <p className="text-sm font-semibold text-mute"><a href="/login" className="font-extrabold text-link hover:underline">Войдите</a>, чтобы оставить отзыв.</p>}

      {r.items.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg" role="group" aria-label="Порядок отзывов">
            {SORTS.map(([k, label]) => <button key={k} type="button" className="seg-item" aria-pressed={sort === k} onClick={() => setSort(k)}>{label}</button>)}
          </div>
          {starFilter > 0 && <button type="button" className="chip-filter on" onClick={() => setStarFilter(0)}>{starFilter} ★ ✕</button>}
        </div>
      )}
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
              {x.reply && replyFor !== x.id && (
                <div className="rv-reply">
                  <span className="rv-reply-k">Ответ администрации{x.replyAt ? ` · ${ago(x.replyAt)}` : ''}</span>
                  <p className="whitespace-pre-line font-semibold">{x.reply}</p>
                </div>
              )}
              {replyFor === x.id && (
                <form className="rv-reply-form" onSubmit={(e) => { e.preventDefault(); void saveReply(x); }}>
                  <textarea className="input min-h-16" value={replyText} onChange={(e) => setReplyText(e.target.value)} maxLength={600} placeholder="Ответ увидят все. Пустой ответ удалит прежний." autoFocus />
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReplyFor(null)}>Отмена</button>
                    <button className="btn btn-sm">Ответить</button>
                  </div>
                </form>
              )}
              <div className="rv-actions">
                {(me || (x.votes ?? 0) > 0) && (
                  <button type="button" className={`rv-vote ${x.voted ? 'is-on' : ''}`} aria-pressed={!!x.voted} disabled={!me} title={me ? 'Отзыв полезен' : 'Войдите, чтобы отметить'} onClick={() => void vote(x)}>
                    <span aria-hidden>👍</span> Полезно{(x.votes ?? 0) > 0 ? ` · ${x.votes}` : ''}
                  </button>
                )}
                {canReply && replyFor !== x.id && (
                  <button type="button" className="btn-link btn-xs" onClick={() => { setReplyFor(x.id); setReplyText(x.reply ?? ''); }}>{x.reply ? 'Изменить ответ' : 'Ответить'}</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
