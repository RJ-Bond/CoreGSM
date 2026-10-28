import { useRef, useState } from 'react';
import type { NewsVariable } from '../../api';
import { LIMITS, newKey, type FieldRow } from './model';
import { MarkdownField } from './MarkdownField';
import { t, useI18n } from '../../i18n';

/** schematic of how the fields sit in Discord: up to three inline ones in a row */
function MiniLayout({ fields }: { fields: FieldRow[] }) {
  useI18n();
  const rows: FieldRow[][] = [];
  let cur: FieldRow[] = [];
  for (const f of fields) {
    if (f.inline) { cur.push(f); if (cur.length === 3) { rows.push(cur); cur = []; } }
    else { if (cur.length) { rows.push(cur); cur = []; } rows.push([f]); }
  }
  if (cur.length) rows.push(cur);
  if (!rows.length) return null;
  return (
    <div className="rounded-2xl bg-soft p-3" aria-label={t('d2.fb.layoutLabel')} role="img">
      <div className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-mute">{t('d2.fb.layout')}</div>
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
            {row.map((f) => (
              <div key={f.k} className="h-4 truncate rounded-sm bg-brand/25 px-1.5 text-xs font-bold leading-4 text-ink">{f.name || '…'}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const Up = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 15l6-6 6 6" /></svg>;
const Down = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>;

const iconBtn = 'btn-icon-sm shrink-0';

export function FieldsBuilder({ fields, onChange, variables }: { fields: FieldRow[]; onChange: (f: FieldRow[]) => void; variables?: NewsVariable[] }) {
  useI18n();
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const cards = useRef<Record<string, HTMLDivElement | null>>({});

  const patch = (i: number, p: Partial<FieldRow>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= fields.length || from === to) return;
    const next = fields.slice();
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <MiniLayout fields={fields} />
      {fields.map((f, i) => (
        <div
          key={f.k}
          ref={(el) => { cards.current[f.k] = el; }}
          onDragOver={(e) => { if (drag !== null) { e.preventDefault(); setOver(i); } }}
          onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); setOver(null); }}
          className={`space-y-2 rounded-2xl bg-soft p-3 transition ${drag === i ? 'opacity-50' : ''} ${over === i && drag !== null && drag !== i ? 'ring-2 ring-brand' : ''}`}
        >
          <div className="flex items-center gap-1.5">
            <span
              draggable
              role="img"
              aria-label={t('d2.fb.drag')}
              title={t('d2.fb.dragTitle')}
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(i));
                const c = cards.current[f.k];
                if (c) e.dataTransfer.setDragImage(c, 16, 16);
              }}
              onDragEnd={() => { setDrag(null); setOver(null); }}
              className="grid h-9 w-7 shrink-0 cursor-grab place-items-center rounded-lg text-mute active:cursor-grabbing"
            >
              <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden><circle cx="4" cy="3" r="1.5" /><circle cx="10" cy="3" r="1.5" /><circle cx="4" cy="9" r="1.5" /><circle cx="10" cy="9" r="1.5" /><circle cx="4" cy="15" r="1.5" /><circle cx="10" cy="15" r="1.5" /></svg>
            </span>
            <input
              id={`news-f${i}-name`}
              aria-label={t('d2.fb.fieldName', { n: i + 1 })}
              className={`input ${f.name.length > LIMITS.fieldName ? 'border-bad!' : ''}`}
              value={f.name}
              placeholder={t('d2.sf.name')}
              onChange={(e) => patch(i, { name: e.target.value })}
            />
            <button type="button" className={iconBtn} aria-label={t('d2.fb.up', { n: i + 1 })} disabled={i === 0} onClick={() => move(i, i - 1)}><Up /></button>
            <button type="button" className={iconBtn} aria-label={t('d2.fb.down', { n: i + 1 })} disabled={i === fields.length - 1} onClick={() => move(i, i + 1)}><Down /></button>
          </div>
          <MarkdownField
            id={`news-f${i}-value`}
            label={t('d2.fb.fieldText', { n: i + 1 })}
            hideLabel
            compact
            rows={2}
            max={LIMITS.fieldValue}
            value={f.value}
            placeholder={t('d2.ws.newsText')}
            variables={variables}
            onChange={(v) => patch(i, { value: v })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <div className="seg" role="group" aria-label={t('d2.fb.placement', { n: i + 1 })}>
              <button type="button" className="seg-item" aria-pressed={!f.inline} onClick={() => patch(i, { inline: false })} title={t('d2.fb.fullTitle')}>
                <span aria-hidden className="mr-1 inline-block h-2.5 w-6 rounded-xs bg-current opacity-60" />{t('d2.fb.full')}
              </button>
              <button type="button" className="seg-item" aria-pressed={f.inline} onClick={() => patch(i, { inline: true })} title={t('d2.fb.inlineTitle')}>
                <span aria-hidden className="mr-1 inline-flex gap-0.5 align-middle"><span className="inline-block h-2.5 w-2 rounded-xs bg-current opacity-60" /><span className="inline-block h-2.5 w-2 rounded-xs bg-current opacity-60" /><span className="inline-block h-2.5 w-2 rounded-xs bg-current opacity-60" /></span>{t('d2.fb.inline')}
              </button>
            </div>
            <span className="ml-auto flex items-center gap-1.5">
              <button type="button" className="btn btn-soft btn-sm" disabled={fields.length >= LIMITS.fields} onClick={() => { const c = fields.slice(); c.splice(i + 1, 0, { ...f, k: newKey() }); onChange(c); }}>{t('d2.news.dup')}</button>
              <button type="button" className="btn btn-danger btn-sm" aria-label={t('d2.fb.delete', { n: i + 1 })} onClick={() => onChange(fields.filter((_, j) => j !== i))}>{t('d2.news.delete')}</button>
            </span>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-soft btn-sm"
        disabled={fields.length >= LIMITS.fields}
        onClick={() => onChange([...fields, { k: newKey(), name: '', value: '', inline: fields.length > 0 && fields.length < 3 }])}
      >
        {t('d2.fb.add')} {fields.length > 0 && <span className="ml-1 text-mute">({fields.length}/{LIMITS.fields})</span>}
      </button>
    </div>
  );
}
