import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { t, useI18n } from '../i18n';
import { Button, fail, toast } from '../ui';

interface Mine { version: number | null; text: string; agreed: boolean }

/** A player who has not agreed to the current version of the community rules sees them here and agrees with one button. */
export default function RulesBanner() {
  useI18n();
  const { me } = useAuth();
  const [r, setR] = useState<Mine | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const player = me?.role === 'player';

  useEffect(() => {
    if (!player) { setR(null); return; }
    let alive = true;
    api<Mine>('/rules/me').then((x) => { if (alive) setR(x); }).catch(() => undefined);
    return () => { alive = false; };
  }, [player, me?.username]);

  if (!player || !r || r.agreed || r.version === null) return null;

  const agree = async () => {
    setBusy(true);
    try {
      await api('/rules/agree', 'POST');
      setR({ ...r, agreed: true });
      toast(t('rl.thanks'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="region" aria-label={t('rl.title')} className="panel mb-4 border-l-4 border-brand p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-black">{t('rl.title')}</div>
          <p className="text-sm font-semibold text-mute">{t('rl.text', { v: r.version })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? t('rl.hide') : t('rl.read')}</button>
          <Button type="button" loading={busy} onClick={() => void agree()}>{t('rl.agree')}</Button>
        </div>
      </div>
      {open && <p className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-ui-lg bg-soft p-3 text-sm font-semibold">{r.text}</p>}
    </div>
  );
}
