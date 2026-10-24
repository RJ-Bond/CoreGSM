import { useRef, useState, type DragEvent } from 'react';
import { api, getToken } from '../../api';
import { useAuth } from '../../auth';
import { t } from '../../i18n';
import { toast, UserAvatar } from '../../ui';
import { errorText } from '../../apiErrors';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** raw-body image upload (PUT, content-type = the file type); resolves, or throws an Error with the server's message */
export async function uploadImage(path: string, file: File, fallback: string): Promise<void> {
  const r = await fetch(`/api${path}`, { method: 'PUT', headers: { 'Content-Type': file.type, Authorization: `Bearer ${getToken()}` }, body: file });
  if (!r.ok) throw new Error(errorText(await r.json().catch(() => null), fallback));
}

/** true while a file is dragged over the element; the handlers go on the element */
export function useDropTarget(onFile: (f: File) => void, disabled = false) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  return {
    over,
    props: {
      onDragEnter: (e: DragEvent) => { if (disabled || !hasFiles(e)) return; e.preventDefault(); depth.current += 1; setOver(true); },
      onDragOver: (e: DragEvent) => { if (disabled || !hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
      onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setOver(false); },
      onDrop: (e: DragEvent) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      },
    },
  };
}

/** Profile picture: upload or drop a photo (cropped to a square on the server), or fall back to the Discord avatar. */
/** `ring`: a colour for the ring round the picture (the rank); with it the editor is the compact one of the profile header: only the picture, the actions in one small line under it */
export function AvatarEditor({ onChanged, size = 80, ring }: { onChanged: () => Promise<void>; size?: number; ring?: string | null }) {
  const { me } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setError('');
    if (!IMAGE_TYPES.includes(file.type)) return setError(t('pf.avatar.badType'));
    if (file.size > 3 * 1024 * 1024) return setError(t('pf.avatar.tooBig'));
    setBusy(true);
    try {
      await uploadImage('/me/avatar', file, t('pf.avatar.failed'));
      toast(t('pf.avatar.updated'));
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const drop = useDropTarget((f) => void upload(f), busy);
  if (!me) return null;

  const remove = async () => {
    setBusy(true);
    await api('/me/avatar', 'DELETE')
      .then(() => toast(me.avatarSource === 'custom' && me.discordName ? t('pf.avatar.discordNow') : t('pf.avatar.removed')))
      .catch((e: Error) => setError(e.message));
    await onChanged();
    setBusy(false);
  };

  const compact = ring !== undefined;
  return (
    <div className={`flex flex-col items-center ${compact ? 'gap-1' : 'gap-2'}`} {...drop.props}>
      <div className={compact ? 'pf-avatar-ring p-1' : undefined} style={compact && ring ? { ['--ring' as string]: ring } : undefined}>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={t('pf.avatar.upload')}
        className={`group relative rounded-3xl ${drop.over ? 'pf-drop-on' : ''}`}
      >
        <UserAvatar name={me.username} url={me.avatarUrl} size={size} tone="brand" className="rounded-3xl!" />
        <span className="absolute inset-0 grid place-items-center rounded-3xl bg-black/50 text-xs font-extrabold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          {busy ? '…' : drop.over ? t('pf.avatar.drop') : t('pf.avatar.change')}
        </span>
      </button>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
      <div className={`flex ${compact ? 'gap-2 text-xs' : 'gap-3 text-sm'} font-extrabold`}>
        <button type="button" className="btn-link" onClick={() => input.current?.click()} disabled={busy}>{t('pf.avatar.uploadLink')}</button>
        {me.avatarSource === 'custom' && <button type="button" className="btn-link-danger" onClick={() => void remove()} disabled={busy}>{me.discordName ? t('pf.avatar.fromDiscord') : t('common.remove')}</button>}
      </div>
      {!compact && <p className="max-w-48 text-center text-xs font-semibold text-mute">{me.avatarSource === 'discord' ? t('pf.avatar.isDiscord') : t('pf.avatar.dragHint')}</p>}
      {error && <p className="max-w-48 text-center text-xs font-bold text-bad" role="alert">{error}</p>}
    </div>
  );
}
