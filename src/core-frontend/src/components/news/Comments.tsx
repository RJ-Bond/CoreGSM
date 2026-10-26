/** Comments under a news item: write, reply, edit within 10 minutes, react, complain; moderators hide and pin. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { confirmDialog, promptDialog } from '../../confirm';
import { t } from '../../i18n';
import { useDraft } from '../../ui/useDraft';
import { ago, Button, ErrorLine, fmtDateTime, toast } from '../../ui';
import { buildThread, parseComment, visibleCount, type CommentItem, type CommentSort } from './commentMd';

interface Thread { enabled: boolean; locked: boolean; canPost: boolean; staff: boolean; items: CommentItem[] }

const EMOJI = ['👍', '❤️', '😂', '🔥'];
const MAX = 1000;
const SORT_KEY = 'nw_comment_sort';
const loadSort = (): CommentSort => {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === 'old' || v === 'top' ? v : 'new';
  } catch {
    return 'new';
  }
};

function Body({ text }: { text: string }) {
  const blocks = useMemo(() => parseComment(text), [text]);
  const inline = (toks: ReturnType<typeof parseComment>[number]['toks']): ReactNode[] =>
    toks.map((k, i) => {
      if (k.t === 'b') return <strong key={i}>{k.v}</strong>;
      if (k.t === 'i') return <em key={i}>{k.v}</em>;
      if (k.t === 'code') return <code key={i}>{k.v}</code>;
      if (k.t === 'mention') return <span key={i} className="cm-mention">@{k.v}</span>;
      if (k.t === 'link') return <a key={i} href={k.href} target="_blank" rel="noopener noreferrer nofollow ugc">{k.v}</a>;
      return k.v;
    });
  return (
    <div className="cm-text">
      {blocks.map((b, i) => (b.quote ? <blockquote key={i}>{inline(b.toks)}</blockquote> : <p key={i}>{b.toks.length ? inline(b.toks) : <br />}</p>))}
    </div>
  );
}

/** the text box: counter, Ctrl+Enter, a hint of nicks after «@» */
function Compose({ initial = '', placeholder, submit, cancel, autoFocus, label, draftKey }: {
  initial?: string; placeholder: string; submit: (text: string) => Promise<void>; cancel?: () => void; autoFocus?: boolean; label: string;
  /** where the unsent text is kept (this browser): a reply or a new comment survives a reload */
  draftKey?: string;
}) {
  const [text, setText, clearText, restored] = useDraft(draftKey ?? null, initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState<string[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (autoFocus) area.current?.focus(); }, [autoFocus]);

  const query = () => {
    const el = area.current;
    if (!el) return null;
    const m = /(?:^|[\s(])@([\p{L}\p{N}_.-]{0,32})$/u.exec(text.slice(0, el.selectionStart));
    return m ? m[1] : null;
  };
  const q = query();
  useEffect(() => {
    if (!q) { setHint([]); return undefined; }
    let dead = false;
    const timer = window.setTimeout(() => {
      api<string[]>(`/news/comments/mentions?q=${encodeURIComponent(q)}`).then((l) => { if (!dead) setHint(l); }).catch(() => { if (!dead) setHint([]); });
    }, 200);
    return () => { dead = true; window.clearTimeout(timer); };
  }, [q]);

  const pick = (name: string) => {
    const el = area.current;
    if (!el) return;
    const upto = text.slice(0, el.selectionStart).replace(/@[\p{L}\p{N}_.-]*$/u, `@${name} `);
    setText(upto + text.slice(el.selectionStart));
    setHint([]);
    el.focus();
  };
  const send = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError('');
    try {
      await submit(text.trim());
      clearText();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); }
    if (e.key === 'Escape' && cancel) cancel();
  };
  return (
    <div className="cm-compose">
      <textarea ref={area} className="input cm-input" rows={3} maxLength={MAX} value={text} placeholder={placeholder} aria-label={label} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
      {hint.length > 0 && (
        <ul className="cm-hint" role="listbox" aria-label={t('nw.cm.mentions')}>
          {hint.map((h) => <li key={h}><button type="button" role="option" aria-selected={false} onClick={() => pick(h)}>@{h}</button></li>)}
        </ul>
      )}
      <ErrorLine text={error} />
      {restored && text && <p className="cm-note">{t('nw.cm.draft')} <button type="button" className="underline" onClick={clearText}>{t('nw.cm.draftDrop')}</button></p>}
      <div className="cm-compose-foot">
        <span className={`cm-counter ${text.length > MAX - 100 ? 'is-near' : ''}`}>{text.length}/{MAX}</span>
        <span className="cm-md-hint">{t('nw.cm.mdHint')}</span>
        <span className="cm-compose-btns">
          {cancel && <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>{t('nw.cm.cancel')}</button>}
          <Button type="button" size="sm" loading={busy} disabled={!text.trim()} onClick={() => void send()}>{t('nw.cm.send')}</Button>
        </span>
      </div>
    </div>
  );
}

export function Comments({ newsId }: { newsId: number }) {
  const { me } = useAuth();
  const [data, setData] = useState<Thread | null>(null);
  const [sort, setSortState] = useState<CommentSort>(loadSort);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState('');
  const canLock = me?.role === 'admin' || !!me?.perms?.includes('news');
  const canModerate = me?.role === 'admin' || !!me?.perms?.includes('moderation');

  const load = () => api<Thread>(`/news/${newsId}/comments`).then((d) => { setData(d); setError(''); }).catch((e: Error) => setError(e.message));
  useEffect(() => { setData(null); void load(); }, [newsId, me?.username]);

  // a link to a comment (#c-12) or to the block (#comments): scroll to it once the thread is drawn
  useEffect(() => {
    if (!data) return undefined;
    const id = window.location.hash.slice(1);
    if (!/^(c-\d+|comments)$/.test(id)) return undefined;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ block: id === 'comments' ? 'start' : 'center' });
      if (id !== 'comments') { el?.classList.add('is-target'); window.setTimeout(() => el?.classList.remove('is-target'), 2500); }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [data !== null]);

  const setSort = (s: CommentSort) => {
    setSortState(s);
    try { localStorage.setItem(SORT_KEY, s); } catch { /* not remembered */ }
  };
  const tree = useMemo(() => buildThread(data?.items ?? [], sort), [data, sort]);
  const act = (fn: () => Promise<unknown>, done?: string) => fn().then(() => { if (done) toast(done); return load(); }).catch((e: Error) => toast(e.message, 'err'));

  const write = async (text: string, parentId?: number) => {
    await api(`/news/${newsId}/comments`, 'POST', { text, ...(parentId ? { parentId } : {}) });
    setReplyTo(null);
    await load();
  };
  const react = (c: CommentItem, emoji: string) => act(() => api(`/news/comments/${c.id}/reaction`, 'PUT', { emoji: c.myReaction === emoji ? null : emoji }));
  const remove = async (c: CommentItem) => {
    if (await confirmDialog({ title: t('nw.cm.deleteTitle'), text: t('nw.cm.deleteText'), confirmLabel: t('nw.cm.delete'), danger: true })) void act(() => api(`/news/comments/${c.id}`, 'DELETE'));
  };
  const flag = async (c: CommentItem) => {
    if (await confirmDialog({ title: t('nw.cm.flagTitle'), text: t('nw.cm.flagText'), confirmLabel: t('nw.cm.flag') })) void act(() => api(`/news/comments/${c.id}/flag`, 'POST'), t('nw.cm.flagged'));
  };
  const hide = async (c: CommentItem) => {
    if (c.hidden) return void act(() => api(`/news/comments/${c.id}/hide`, 'POST', { restore: true }));
    const reason = await promptDialog({ title: t('nw.cm.hideTitle'), label: t('nw.cm.hideReason'), confirmLabel: t('nw.cm.hide'), placeholder: t('nw.cm.hideHolder') });
    if (reason !== null) void act(() => api(`/news/comments/${c.id}/hide`, 'POST', { reason }));
  };
  const pin = (c: CommentItem) => act(() => api(`/news/comments/${c.id}/pin`, 'POST', { pinned: !c.pinned }));
  const lock = () => act(() => api(`/news/${newsId}/comments/lock`, 'PUT', { locked: !data?.locked }));

  if (!data && !error) return <section id="comments" className="nw-comments" aria-busy="true"><div className="skeleton h-24 rounded-2xl" /></section>;
  if (data && !data.enabled) return null;
  const count = data ? visibleCount(data.items) : 0;

  const one = (c: CommentItem, nested: boolean) => {
    const staffAuthor = c.role !== 'user';
    return (
      <article key={c.id} id={`c-${c.id}`} className={`cm ${nested ? 'is-reply' : ''} ${c.pinned ? 'is-pinned' : ''}`}>
        <header className="cm-head">
          <span className="cm-ava" aria-hidden>{c.author.slice(0, 1).toUpperCase()}</span>
          <b className="cm-author">{c.author}</b>
          {staffAuthor && <span className="pill pill-ok">{c.role === 'admin' ? t('nw.role.admin') : t('nw.role.moderator')}</span>}
          {c.pinned && <span className="pill pill-warn">📌 {t('nw.cm.pinned')}</span>}
          <a className="cm-time" href={`#c-${c.id}`} title={fmtDateTime(c.createdAt)}>{ago(c.createdAt)}</a>
          {c.editedAt && <span className="cm-time" title={fmtDateTime(c.editedAt)}>{t('nw.cm.edited')}</span>}
        </header>
        {c.deleted ? (
          <p className="cm-stub">{t('nw.cm.deletedStub')}</p>
        ) : editing === c.id ? (
          <Compose autoFocus initial={c.text} label={t('nw.cm.editLabel')} placeholder="" submit={async (text) => { await api(`/news/comments/${c.id}`, 'PATCH', { text }); setEditing(null); await load(); }} cancel={() => setEditing(null)} />
        ) : (
          <>
            {c.hidden && <p className="cm-stub">{t('nw.cm.hiddenStub')}{c.hideReason ? `: ${c.hideReason}` : ''}</p>}
            {c.text && <Body text={c.text} />}
          </>
        )}
        {!c.deleted && !c.hidden && (
          <footer className="cm-foot">
            <span className="cm-reacts" role="group" aria-label={t('nw.cm.reactions')}>
              {EMOJI.map((e) => (
                <button key={e} type="button" className="cm-react" aria-pressed={c.myReaction === e} disabled={!me} title={me ? undefined : t('nw.react.login')} onClick={() => void react(c, e)}>
                  <span aria-hidden>{e}</span>
                  {(c.reactions[e] ?? 0) > 0 && <span className="tabular-nums">{c.reactions[e]}</span>}
                </button>
              ))}
            </span>
            {data?.canPost && <button type="button" className="cm-act" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>{t('nw.cm.reply')}</button>}
            {c.canEdit && <button type="button" className="cm-act" onClick={() => setEditing(c.id)}>{t('nw.cm.edit')}</button>}
            {c.mine && <button type="button" className="cm-act" onClick={() => void remove(c)}>{t('nw.cm.delete')}</button>}
            {me && !c.mine && !c.flagged && <button type="button" className="cm-act" onClick={() => void flag(c)}>{t('nw.cm.flag')}</button>}
            {c.flagged && <span className="cm-time">{t('nw.cm.flagged')}</span>}
            {canModerate && !c.mine && <button type="button" className="cm-act" onClick={() => void hide(c)}>{t('nw.cm.hide')}</button>}
            {canModerate && !nested && <button type="button" className="cm-act" onClick={() => void pin(c)}>{c.pinned ? t('nw.cm.unpin') : t('nw.cm.pin')}</button>}
            {canModerate && (c.flags ?? 0) > 0 && <span className="pill pill-bad">{t('nw.cm.flags', { n: c.flags ?? 0 })}</span>}
          </footer>
        )}
        {c.hidden && canModerate && <footer className="cm-foot"><button type="button" className="cm-act" onClick={() => void hide(c)}>{t('nw.cm.show')}</button></footer>}
        {replyTo === c.id && (
          <Compose autoFocus label={t('nw.cm.replyLabel', { name: c.author })} placeholder={t('nw.cm.replyHolder', { name: c.author })} draftKey={`reply-${c.id}`} submit={(text) => write(text, c.id)} cancel={() => setReplyTo(null)} />
        )}
      </article>
    );
  };

  return (
    <section id="comments" className="nw-comments" aria-label={t('nw.cm.title')}>
      <div className="cm-top">
        <h2 className="nw-h2">{t('nw.cm.title')}{count > 0 && <span className="cm-total tabular-nums"> {count}</span>}</h2>
        {count > 1 && (
          <div className="seg" role="group" aria-label={t('nw.cm.sort')}>
            {(['new', 'old', 'top'] as const).map((s) => <button key={s} type="button" className="seg-item" aria-current={sort === s ? 'true' : undefined} onClick={() => setSort(s)}>{t(`nw.cm.sort.${s}` as const)}</button>)}
          </div>
        )}
        {canLock && data && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void lock()}>{data.locked ? t('nw.cm.open') : t('nw.cm.close')}</button>}
      </div>
      <ErrorLine text={error} />
      {data?.locked && <p className="cm-note">{t('nw.cm.locked')}</p>}
      {data?.canPost && <Compose draftKey={`news-${newsId}`} label={t('nw.cm.write')} placeholder={t('nw.cm.holder')} submit={(text) => write(text)} />}
      {data && !data.canPost && !data.locked && !me && <p className="cm-note"><a href="/login">{t('nw.cm.login')}</a></p>}
      {data && tree.length === 0 && <p className="cm-empty">{t('nw.cm.empty')}</p>}
      <div className="cm-list">
        {tree.map(({ top, replies }) => (
          <div key={top.id} className="cm-thread">
            {one(top, false)}
            {replies.length > 0 && <div className="cm-replies">{replies.map((r) => one(r, true))}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
