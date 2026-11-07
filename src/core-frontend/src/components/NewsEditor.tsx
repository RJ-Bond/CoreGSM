import { useMemo, useRef, useState } from 'react';
import { t, useI18n } from '../i18n';
import {
  MAX_VISIBLE, SWATCHES, TEMPLATES, colorOpen, isHex, parseNews, unbalanced, visibleText, wrapSelection,
} from '../gameNews';
import { Field } from '../ui';

const swatchName = (id: string) => t(`gn.c.${id}` as 'gn.c.info');

/** the text with its tags drawn as colour, bold and italic */
export function Styled({ text }: { text: string }) {
  return (
    <>
      {parseNews(text).map((s, i) => (
        <span key={i} style={{ color: s.color ?? undefined, fontWeight: s.bold ? 800 : undefined, fontStyle: s.italic ? 'italic' : undefined }}>{s.text}</span>
      ))}
    </>
  );
}

/** how a message looks in the in-game chat (approximate: the colours are exact, the font and background are not) */
export function NewsPreview({ text }: { text: string }) {
  useI18n();
  const has = useMemo(() => parseNews(text).length > 0, [text]);
  return (
    <div className="panel space-y-3 p-5">
      <h3 className="font-extrabold">{t('gn.preview')}</h3>
      <div className="rounded-xl p-4 font-semibold" style={{ background: '#15121c', color: '#e8e3f0' }} aria-live="polite">
        <div className="mb-1 text-xs font-bold uppercase tracking-wide" style={{ color: '#8f86a3' }}>{t('gn.chatLabel')}</div>
        {has ? <p className="wrap-break-word"><Styled text={text} /></p> : <p style={{ color: '#8f86a3' }}>{t('gn.previewEmpty')}</p>}
      </div>
      <p className="text-sm font-semibold text-mute">{t('gn.previewNote')}</p>
    </div>
  );
}

/** a text box with a toolbar: colours, bold, italic, templates and a length counter */
export function NewsEditor({ value, onChange, templates = true, label }: { value: string; onChange: (v: string) => void; templates?: boolean; label?: string }) {
  useI18n();
  const [custom, setCustom] = useState('#FF8A00');
  const area = useRef<HTMLTextAreaElement>(null);
  const visible = visibleText(value).trim().length;

  const wrap = (open: string, close: string) => {
    const el = area.current;
    const r = wrapSelection(value, el?.selectionStart ?? value.length, el?.selectionEnd ?? value.length, open, close);
    onChange(r.text);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(r.start, r.end); });
  };

  return (
    <div className="space-y-4">
      {templates && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('gn.templates')}>
          <span className="self-center text-sm font-bold text-mute">{t('gn.templates')}:</span>
          {TEMPLATES.map((x) => (
            <button key={x.id} type="button" className="chip-filter" onClick={() => onChange(x.text(t('gn.tpl.when')))}>{t(`gn.tpl.${x.id}` as 'gn.tpl.restart')}</button>
          ))}
        </div>
      )}

      <Field label={label ?? t('gn.message')}>
        <textarea
          ref={area}
          className="input min-h-32 font-mono text-sm"
          value={value}
          rows={5}
          maxLength={700}
          placeholder={t('gn.placeholder')}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('gn.colors')}>
        {SWATCHES.map((s) => (
          <button
            key={s.id}
            type="button"
            className="h-8 w-8 rounded-full border border-line"
            style={{ background: s.hex }}
            title={swatchName(s.id)}
            aria-label={t('gn.colorize', { name: swatchName(s.id) })}
            onClick={() => wrap(colorOpen(s.hex), '</color>')}
          />
        ))}
        <input className="input w-28 font-mono text-sm" value={custom} maxLength={7} aria-label={t('gn.customHex')} onChange={(e) => setCustom(e.target.value)} />
        <button type="button" className="btn btn-soft btn-sm" disabled={!isHex(custom)} onClick={() => wrap(colorOpen(custom), '</color>')}>{t('gn.applyHex')}</button>
        <button type="button" className="btn btn-soft btn-sm font-black" onClick={() => wrap('<b>', '</b>')} aria-label={t('gn.bold')}>B</button>
        <button type="button" className="btn btn-soft btn-sm italic" onClick={() => wrap('<i>', '</i>')} aria-label={t('gn.italic')}>I</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(visibleText(value))}>{t('gn.clearTags')}</button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-mute">
        <span className={visible > MAX_VISIBLE ? 'text-danger' : undefined}>{t('gn.counter', { n: visible, max: MAX_VISIBLE })}</span>
        {unbalanced(value) && <span>{t('gn.unbalanced')}</span>}
      </div>
    </div>
  );
}
