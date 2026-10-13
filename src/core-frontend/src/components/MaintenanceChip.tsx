import { IconWrench } from '../icons';
import { chipText } from '../maintenance';
import { fmtTime } from '../ui';

/** «Тех. работы до 05:00»: shown on server cards, rows, the TV mode and in the passport while a window is active */
export default function MaintenanceChip({ m, glass = false, className = '' }: { m: { name?: string; until: number | null }; glass?: boolean; className?: string }) {
  return (
    <span className={`maint-chip ${glass ? 'maint-chip-glass' : ''} ${className}`} title={m.name || undefined}>
      <IconWrench size={13} />
      <span className="truncate">{chipText(m, Date.now(), (ts) => fmtTime(ts))}</span>
    </span>
  );
}
