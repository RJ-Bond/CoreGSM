/**
 * The screenshot gallery (/gallery): pictures from the players, the starred ones first. A click opens the picture
 * full size (arrows and Esc work). Signed-in players upload their own; until the staff approve a picture only its
 * author sees it, under «Мои скриншоты».
 */
import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import { api, getToken, type Server } from '../api';
import { errorText } from '../apiErrors';
import { useAuth } from '../auth';
import { IMAGE_TYPES, useDropTarget } from '../components/profile/AvatarEditor';
import { Button, Empty, ErrorLine, Field, Modal, PageHead, ago, toast } from '../ui';
import '../styles/gallery.css';

export interface Shot {
  id: number;
  url: string;
  thumb: string;
  caption: string;
  author: string | null;
  serverId: number | null;
  serverName: string | null;
  status: 'pending' | 'approved' | 'rejected';
  featured: boolean;
  width: number;
  height: number;
  createdAt: number;
}

const IconImage = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" />
  </svg>
);

/** the full-size viewer over the page */
export function Lightbox({ list, index, onClose, onIndex }: { list: Shot[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  const s = list[index];
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') onIndex((index + 1) % list.length);
      else if (e.key === 'ArrowLeft') onIndex((index - 1 + list.length) % list.length);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [index, list.length, onClose, onIndex]);
  // the neighbours are loaded in advance, so a step is instant
  useEffect(() => {
    for (const k of [index + 1, index - 1]) {
      const n = list[(k + list.length) % list.length];
      if (n && n !== list[index]) new Image().src = n.url;
    }
  }, [index, list]);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onStart = (e: TouchEvent) => { touch.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; };
  const onEnd = (e: TouchEvent) => {
    const t0 = touch.current;
    touch.current = null;
    if (!t0 || list.length < 2) return;
    const dx = e.changedTouches[0].clientX - t0.x;
    const dy = e.changedTouches[0].clientY - t0.y;
    if (Math.abs(dx) > 60 && Math.abs(dy) < Math.abs(dx) * 0.6) onIndex((index + (dx < 0 ? 1 : -1) + list.length) % list.length);
    else if (dy > 90 && Math.abs(dx) < dy * 0.6) onClose();
  };
  if (!s) return null;
  return (
    <div className="gl-box" role="dialog" aria-modal="true" aria-label={s.caption || 'Скриншот'} onClick={onClose} onTouchStart={onStart} onTouchEnd={onEnd}>
      <figure className="gl-box-fig" onClick={(e) => e.stopPropagation()}>
        <img key={s.id} src={s.url} alt={s.caption || 'Скриншот'} width={s.width} height={s.height} style={{ backgroundImage: `url(${s.thumb})`, backgroundSize: 'cover' }} />
        <figcaption>
          <span className="min-w-0 flex-1">
            {s.caption && <span className="block font-extrabold">{s.caption}</span>}
            <span className="block text-sm font-semibold opacity-75">{[s.author, s.serverName, ago(s.createdAt)].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="text-sm font-bold opacity-75">{index + 1} / {list.length}</span>
        </figcaption>
      </figure>
      {list.length > 1 && (
        <div className="gl-box-strip" onClick={(e) => e.stopPropagation()} role="tablist" aria-label="Все скриншоты">
          {list.map((x, i) => (
            <button key={x.id} type="button" role="tab" aria-selected={i === index} className={i === index ? 'is-on' : ''} onClick={() => onIndex(i)} aria-label={x.caption || `Скриншот ${i + 1}`}>
              <img src={x.thumb} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {list.length > 1 && (
        <>
          <button type="button" className="gl-box-nav is-prev" aria-label="Предыдущий" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + list.length) % list.length); }}>‹</button>
          <button type="button" className="gl-box-nav is-next" aria-label="Следующий" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % list.length); }}>›</button>
        </>
      )}
      <button type="button" className="gl-box-close" aria-label="Закрыть" onClick={onClose}>✕</button>
    </div>
  );
}

/** a thumbnail that fades in once loaded, on a shimmering box of the right proportions (the page does not jump) */
function ShotImg({ shot }: { shot: Shot }) {
  const [ok, setOk] = useState(false);
  return (
    <span className={`gl-ph ${ok ? 'is-ok' : 'skeleton'}`} style={{ aspectRatio: `${shot.width} / ${shot.height}` }}>
      <img
        ref={(el) => { if (el?.complete && !ok) setOk(true); }}
        src={shot.thumb}
        alt=""
        loading="lazy"
        width={640}
        height={Math.round((640 * shot.height) / shot.width)}
        onLoad={() => setOk(true)}
        onError={() => setOk(true)}
      />
    </span>
  );
}

export function ShotGrid({ list, onOpen, badge }: { list: Shot[]; onOpen: (i: number) => void; badge?: (s: Shot) => string | null }) {
  return (
    <ul className="gl-grid">
      {list.map((s, i) => (
        <li key={s.id} className="gl-cell">
          <button type="button" className="gl-shot" onClick={() => onOpen(i)} aria-label={s.caption || `Скриншот ${i + 1}`}>
            <ShotImg shot={s} />
            {s.featured && <span className="gl-star" title="Лучшее">★</span>}
            {badge?.(s) && <span className="gl-badge">{badge(s)}</span>}
            {(s.caption || s.author) && (
              <span className="gl-cap">
                {s.caption && <span className="block truncate font-extrabold">{s.caption}</span>}
                <span className="block truncate text-xs font-bold opacity-80">{[s.author, s.serverName].filter(Boolean).join(' · ')}</span>
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function UploadForm({ servers, onClose, onDone, initial }: { servers: Server[]; onClose: () => void; onDone: (s: Shot) => void; initial?: File | null }) {
  const [file, setFile] = useState<File | null>(initial ?? null);
  const [preview, setPreview] = useState('');
  const [caption, setCaption] = useState('');
  const [serverId, setServerId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const send = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const q = new URLSearchParams({ caption: caption.trim() });
      if (serverId) q.set('serverId', String(serverId));
      const r = await fetch(`/api/gallery?${q.toString()}`, { method: 'POST', headers: { 'Content-Type': file.type, Authorization: `Bearer ${getToken() ?? ''}` }, body: file });
      const j = (await r.json().catch(() => null)) as (Shot & { error?: string }) | null;
      if (!r.ok || !j) throw new Error(errorText(j, 'Не удалось загрузить картинку (PNG, JPG или WebP до 8 МБ)'));
      onDone(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Новый скриншот" onClose={onClose}>
      <div className="space-y-3.5">
        <label className={`gl-drop ${preview ? 'has-file' : ''}`}>
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {preview ? <img src={preview} alt="" /> : <span className="font-extrabold text-mute">Выберите картинку: PNG, JPG или WebP до 8 МБ</span>}
        </label>
        <Field label="Подпись (необязательно)"><input className="input" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={140} placeholder="Например: закат над замком" /></Field>
        <Field label="Сервер">
          <select className="input" value={serverId} onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Не указывать</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <p className="text-sm font-semibold text-mute">Скриншот появится в галерее после проверки модератором.</p>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <Button loading={busy} disabled={!file} onClick={() => void send()} type="button">Отправить</Button>
        </div>
      </div>
    </Modal>
  );
}

const STATUS: Record<Shot['status'], string | null> = { pending: 'на проверке', rejected: 'отклонён', approved: null };

export default function GalleryPage() {
  const { me } = useAuth();
  const [list, setList] = useState<Shot[] | null>(null);
  const [mine, setMine] = useState<Shot[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [open, setOpen] = useState<{ list: Shot[]; i: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dropped, setDropped] = useState<File | null>(null);
  const [error, setError] = useState('');
  const topRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api<Shot[]>('/gallery?limit=200').then(setList).catch((e: Error) => setError(e.message));
    if (me) api<Shot[]>('/gallery/mine').then((m) => setMine(m.filter((s) => s.status !== 'approved'))).catch(() => undefined);
  }, [me]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (me) api<Server[]>('/servers').then(setServers).catch(() => undefined); }, [me]);

  // a picture dropped anywhere on the page opens the upload form with it
  const drop = useDropTarget((f) => {
    if (!me) return toast('Войдите, чтобы загрузить скриншот', 'err');
    if (!IMAGE_TYPES.includes(f.type)) return toast('Нужна картинка: PNG, JPG или WebP', 'err');
    setDropped(f);
    setUploading(true);
  }, uploading);
  return (
    <div className="space-y-5" ref={topRef} {...drop.props}>
      {drop.over && <div className="gl-dropzone" aria-hidden><span>Отпустите, чтобы загрузить скриншот</span></div>}
      <PageHead
        icon={<IconImage />}
        title="Галерея"
        subtitle="Скриншоты игроков с наших серверов"
      >
        {me ? <button type="button" className="btn" onClick={() => setUploading(true)}>Загрузить скриншот</button> : <a href="/login" className="btn btn-soft">Войдите, чтобы загрузить</a>}
      </PageHead>
      <ErrorLine text={error} />
      {mine.length > 0 && (
        <section className="tile p-4 sm:p-5">
          <h2 className="mb-3 text-lg font-extrabold">Мои скриншоты на проверке</h2>
          <ShotGrid list={mine} onOpen={(i) => setOpen({ list: mine, i })} badge={(s) => STATUS[s.status]} />
        </section>
      )}
      {list === null ? (
        <div className="gl-grid" aria-busy="true">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-48 rounded-2xl" />)}</div>
      ) : list.length === 0 ? (
        <Empty title="Скриншотов пока нет" text="Поделитесь красивым кадром из игры: он появится здесь после проверки.">{me ? <button type="button" className="btn mt-2" onClick={() => setUploading(true)}>Загрузить первый скриншот</button> : <a href="/login" className="btn btn-soft mt-2">Войти и загрузить</a>}</Empty>
      ) : (
        <ShotGrid list={list} onOpen={(i) => setOpen({ list, i })} />
      )}
      {open && <Lightbox list={open.list} index={open.i} onClose={() => setOpen(null)} onIndex={(i) => setOpen({ ...open, i })} />}
      {uploading && (
        <UploadForm
          servers={servers}
          initial={dropped}
          onClose={() => { setUploading(false); setDropped(null); }}
          onDone={(s) => {
            setUploading(false);
            setDropped(null);
            toast(s.status === 'approved' ? 'Скриншот опубликован' : 'Скриншот отправлен на проверку');
            load();
          }}
        />
      )}
    </div>
  );
}
