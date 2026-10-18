// Pure part of the common «Save / Cancel» bar of the settings pages: what the bar says and which forms it saves.
import type { SaveStatus } from './autosave';

export interface BarEntry { label: string; status: SaveStatus }

/** a form has something the bar must offer to save: an edit, a refused edit or a failed save */
export const needsBar = (s: SaveStatus): boolean => s === 'dirty' || s === 'invalid' || s === 'error';

export interface BarState {
  /** the bar is shown */
  show: boolean;
  /** ids of the forms that can be saved now (valid) */
  saveIds: string[];
  /** some form is invalid: «Сохранить» is off until it is fixed */
  blocked: boolean;
  /** a request is running */
  saving: boolean;
  /** the failed save is the news */
  failed: boolean;
  /** «Изменено: A, B» */
  text: string;
}

export function summarize(entries: Record<string, BarEntry>): BarState {
  const all = Object.entries(entries);
  const dirty = all.filter(([, e]) => needsBar(e.status));
  const saving = all.some(([, e]) => e.status === 'saving');
  const blocked = dirty.some(([, e]) => e.status === 'invalid');
  const labels = dirty.map(([, e]) => e.label);
  const failed = dirty.some(([, e]) => e.status === 'error');
  return {
    show: dirty.length > 0 || saving,
    saveIds: dirty.filter(([, e]) => e.status === 'dirty' || e.status === 'error').map(([id]) => id),
    blocked,
    saving,
    failed,
    text: failed ? `Не сохранено: ${labels.join(', ')}` : labels.length ? `Есть несохранённые изменения: ${labels.join(', ')}` : 'Сохраняется…',
  };
}
