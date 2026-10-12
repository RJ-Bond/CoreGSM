import { useMemo } from 'react';
import { Button, Modal } from '../../ui';
import { runChecks, type Check, type Draft } from './model';

const MARK: Record<Check['level'], { icon: string; cls: string; label: string }> = {
  ok: { icon: '✓', cls: 'bg-okbg text-ok', label: 'Готово' },
  warn: { icon: '!', cls: 'bg-warnbg text-warn', label: 'Предупреждение' },
  error: { icon: '✕', cls: 'bg-badbg text-bad', label: 'Ошибка' },
};

/** Pre-send checklist: errors block, warnings can be overridden. */
export function ChecklistModal({
  draft, mode, scheduleText, busy, onConfirm, onClose,
}: { draft: Draft; mode: 'now' | 'schedule' | 'edit'; scheduleText?: string; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  const checks = useMemo(() => runChecks(draft), [draft]);
  const errors = checks.filter((c) => c.level === 'error');
  const warns = checks.filter((c) => c.level === 'warn');
  const verb = mode === 'schedule' ? 'Запланировать' : mode === 'edit' ? 'Сохранить в Discord' : 'Опубликовать';
  // problems first
  const sorted = [...errors, ...warns, ...checks.filter((c) => c.level === 'ok')];
  return (
    <Modal title="Проверка перед отправкой" onClose={onClose}>
      {scheduleText && <p className="mb-3 text-sm font-bold text-mute">{scheduleText}</p>}
      <ul className="space-y-2" aria-label="Результаты проверки">
        {sorted.map((c, i) => (
          <li key={i} className="flex items-start gap-3 rounded-2xl bg-soft px-3 py-2.5">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-sm font-black ${MARK[c.level].cls}`} aria-label={MARK[c.level].label}>{MARK[c.level].icon}</span>
            <span className="min-w-0 text-sm font-bold">{c.text}</span>
          </li>
        ))}
      </ul>
      {errors.length > 0 && <p className="mt-3 text-sm font-bold text-bad" role="alert">Исправьте ошибки, чтобы продолжить.</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button className="flex-1" loading={busy} disabled={errors.length > 0} onClick={onConfirm}>
          {warns.length > 0 ? `${verb} всё равно` : verb}
        </Button>
        <Button variant="soft" onClick={onClose}>Назад к редактору</Button>
      </div>
    </Modal>
  );
}
