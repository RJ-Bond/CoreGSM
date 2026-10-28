import { useMemo } from 'react';
import { Button, Modal } from '../../ui';
import { t, useI18n, type TKey } from '../../i18n';
import { runChecks, type Check, type Draft } from './model';

const MARK: Record<Check['level'], { icon: string; cls: string; label: TKey }> = {
  ok: { icon: '✓', cls: 'bg-okbg text-ok', label: 'wn.done' },
  warn: { icon: '!', cls: 'bg-warnbg text-warn', label: 'd2.ck.warning' },
  error: { icon: '✕', cls: 'bg-badbg text-bad', label: 'd2.ck.error' },
};

/** Pre-send checklist: errors block, warnings can be overridden. */
export function ChecklistModal({
  draft, mode, scheduleText, busy, onConfirm, onClose,
}: { draft: Draft; mode: 'now' | 'schedule' | 'edit'; scheduleText?: string; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  useI18n();
  const checks = useMemo(() => runChecks(draft), [draft]);
  const errors = checks.filter((c) => c.level === 'error');
  const warns = checks.filter((c) => c.level === 'warn');
  const verb = mode === 'schedule' ? t('d2.ck.schedule') : mode === 'edit' ? t('d2.ck.saveDiscord') : t('d2.news.publish');
  // problems first
  const sorted = [...errors, ...warns, ...checks.filter((c) => c.level === 'ok')];
  return (
    <Modal title={t('d2.ck.title')} onClose={onClose}>
      {scheduleText && <p className="mb-3 text-sm font-bold text-mute">{scheduleText}</p>}
      <ul className="space-y-2" aria-label={t('d2.ck.results')}>
        {sorted.map((c, i) => (
          <li key={i} className="flex items-start gap-3 rounded-2xl bg-soft px-3 py-2.5">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-sm font-black ${MARK[c.level].cls}`} aria-label={t(MARK[c.level].label)}>{MARK[c.level].icon}</span>
            <span className="min-w-0 text-sm font-bold">{c.text}</span>
          </li>
        ))}
      </ul>
      {errors.length > 0 && <p className="mt-3 text-sm font-bold text-bad" role="alert">{t('d2.ck.fix')}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="ghost" onClick={onClose}>{t('d2.ck.back')}</Button>
        <Button className="flex-1" loading={busy} disabled={errors.length > 0} onClick={onConfirm}>
          {warns.length > 0 ? t('d2.ck.anyway', { verb }) : verb}
        </Button>
      </div>
    </Modal>
  );
}
