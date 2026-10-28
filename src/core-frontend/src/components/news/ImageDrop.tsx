import { useEffect, useRef, useState } from 'react';
import { MAX_UPLOAD, uploadImage } from './model';
import { t, useI18n } from '../../i18n';

export interface ImageDropApi { upload: (file: File) => Promise<void> }

/** Drag-and-drop / pick / paste-url image input with preview, clearing and size warnings. */
export function ImageDrop({
  id, label, url, upload, onUrl, onUpload, allowUpload, minWidth, bind,
}: {
  id: string;
  label: string;
  url: string;
  upload: string;
  onUrl: (v: string) => void;
  onUpload: (name: string) => void;
  allowUpload?: boolean;
  /** warn when the picture is narrower than this */
  minWidth?: number;
  /** gives the parent a way to upload a file (paste from the clipboard) */
  bind?: (api: ImageDropApi | null) => void;
}) {
  useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hot, setHot] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const src = upload ? `/api/news/images/${upload}` : /^https?:\/\//i.test(url) ? url : '';

  const doUpload = async (file: File | undefined) => {
    if (!file || !allowUpload) return;
    setBusy(true);
    setErr('');
    try {
      const name = await uploadImage(file);
      setSize(file.size);
      onUpload(name);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doUploadRef = useRef(doUpload);
  doUploadRef.current = doUpload;
  useEffect(() => {
    bind?.({ upload: (f) => doUploadRef.current(f) });
    return () => bind?.(null);
  }, [bind]);

  useEffect(() => { setDims(null); }, [src]);

  const warns: string[] = [];
  if (size && size > MAX_UPLOAD * 0.6) warns.push(t('d2.idr.heavy', { mb: (size / 1048576).toFixed(1) }));
  if (dims && minWidth && dims.w < minWidth) warns.push(t('d2.idr.small', { w: dims.w, h: dims.h, min: minWidth }));
  if (url && !upload && !/^https:\/\//i.test(url)) warns.push(t('d2.idr.https'));

  return (
    <div className="flash-host space-y-2">
      <span className="label mb-0!">{label}</span>
      {src ? (
        <div className="flex items-center gap-3 rounded-2xl bg-soft p-2">
          <img src={src} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{upload ? t('d2.idr.uploaded') : url}</div>
            {dims && <div className="text-xs font-semibold text-mute">{dims.w}×{dims.h}{size && upload ? ` · ${t('d2.bk.kb', { v: (size / 1024).toFixed(0) })}` : ''}</div>}
          </div>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => { onUpload(''); onUrl(''); setSize(null); }}>{t('common.remove')}</button>
        </div>
      ) : (
        <div
          onDragOver={(e) => { if (allowUpload) { e.preventDefault(); setHot(true); } }}
          onDragLeave={() => setHot(false)}
          onDrop={(e) => { e.preventDefault(); setHot(false); void doUpload(Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))); }}
          className={`rounded-2xl border-2 border-dashed p-3 text-center transition ${hot ? 'border-brand bg-brand/10' : 'border-line'}`}
        >
          {allowUpload && (
            <button type="button" disabled={busy} onClick={() => input.current?.click()} className="btn btn-ghost btn-sm btn-block">
              {busy ? t('nw.loadingMore') : t('d2.idr.drop')}
              <span className="block text-xs font-semibold">{t('d2.idr.formats')}</span>
            </button>
          )}
          <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" aria-label={t('d2.idr.pickFile', { label })} onChange={(e) => { void doUpload(e.target.files?.[0]); e.target.value = ''; }} />
          <input id={id} aria-label={t('d2.idr.link', { label })} className="input mt-1" value={url} onChange={(e) => onUrl(e.target.value.trim())} placeholder={t('d2.idr.ph')} />
        </div>
      )}
      {src && !upload && <input id={id} aria-label={t('d2.idr.link', { label })} className="sr-only" value={url} onChange={(e) => onUrl(e.target.value.trim())} />}
      {err && <p className="text-sm font-bold text-bad" role="alert">{err}</p>}
      {warns.map((w) => <p key={w} className="rounded-xl bg-warnbg px-3 py-1.5 text-sm font-bold text-warn">⚠ {w}</p>)}
    </div>
  );
}
