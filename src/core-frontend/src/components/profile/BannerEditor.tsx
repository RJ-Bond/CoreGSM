import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { t } from '../../i18n';
import { Button, ErrorLine, IconUpload, Section, toast } from '../../ui';
import { IMAGE_TYPES, uploadImage, useDropTarget } from './AvatarEditor';
import { BANNER_PRESETS, bannerStyle } from './banner';

const MAX_BYTES = 4 * 1024 * 1024;

interface Pending { file: File; url: string; w: number; h: number }

/**
 * Banner of the profile: an uploaded picture (checked here for type and size, shown as a preview before it is saved;
 * the server fits it, nothing is cropped on this side) or one of the gradient presets.
 */
export function BannerEditor({ onChanged }: { onChanged: () => Promise<void> }) {
  const { me } = useAuth();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // the object URL of the preview is released when it is replaced or the editor closes
  useEffect(() => () => { if (pending) URL.revokeObjectURL(pending.url); }, [pending]);

  const pick = (file: File) => {
    setError('');
    if (!IMAGE_TYPES.includes(file.type)) return setError(t('pf.banner.badType'));
    if (file.size > MAX_BYTES) return setError(t('pf.banner.tooBig'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setPending({ file, url, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => { URL.revokeObjectURL(url); setError(t('pf.banner.unreadable')); };
    img.src = url;
  };
  const drop = useDropTarget(pick, busy);
  if (!me) return null;

  const save = async () => {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      await uploadImage('/me/banner', pending.file, t('pf.banner.failed'));
      toast(t('pf.banner.updated'));
      setPending(null);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setPreset = async (preset: string) => {
    setBusy(true);
    setError('');
    try {
      await api('/me/banner-preset', 'PUT', { preset });
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      if (me.bannerUrl) await api('/me/banner', 'DELETE');
      if (me.bannerPreset) await api('/me/banner-preset', 'PUT', { preset: '' });
      toast(t('pf.banner.removed'));
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ratio = pending ? pending.w / Math.max(1, pending.h) : 3;
  const offRatio = pending ? ratio < 2.2 || ratio > 4.2 : false;
  const hasBanner = !!me.bannerUrl || !!me.bannerPreset;

  return (
    <Section title={t('pf.banner.title')} description={t('pf.banner.desc')}>
      <div role="img" aria-label={t('pf.banner.preview')} className="pf-banner-ratio" style={pending ? { backgroundImage: `url(${pending.url})` } : bannerStyle(me.bannerUrl, me.bannerPreset)} />

      {pending ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-mute">
            {pending.file.name} · {pending.w}×{pending.h}
          </p>
          {offRatio && <p className="rounded-2xl bg-warnbg px-4 py-2.5 text-sm font-bold text-warn" role="status">{t('pf.banner.ratioWarn')}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setPending(null)} disabled={busy}>{t('common.cancel')}</button>
            <Button loading={busy} onClick={() => void save()}>{t('pf.banner.apply')}</Button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className={`pf-zone ${drop.over ? 'pf-drop-on' : ''}`} onClick={() => input.current?.click()} disabled={busy} {...drop.props}>
            <span className="text-link"><IconUpload /></span>
            <span className="font-extrabold">{t('pf.banner.choose')}</span>
            <span className="text-sm font-semibold text-mute">{t('pf.banner.hint')}</span>
          </button>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
        </>
      )}

      <div>
        <span id="banner-presets" className="label">{t('pf.banner.presets')}</span>
        <div className="pf-presets" role="group" aria-labelledby="banner-presets">
          {BANNER_PRESETS.map((p) => (
            <button key={p.id} type="button" className="pf-preset" aria-pressed={!me.bannerUrl && me.bannerPreset === p.id} disabled={busy} onClick={() => void setPreset(p.id)}>
              <span className="pf-preset-sw" style={{ backgroundImage: p.css }} />
              <span className="pf-preset-name">{t(p.label)}</span>
            </button>
          ))}
        </div>
      </div>

      <ErrorLine text={error} />
      {hasBanner && (
        <button type="button" className="btn btn-danger btn-sm" onClick={() => void remove()} disabled={busy}>{t('pf.banner.remove')}</button>
      )}
    </Section>
  );
}
