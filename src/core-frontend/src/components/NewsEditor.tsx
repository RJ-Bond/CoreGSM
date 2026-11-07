import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { confirmDialog, promptDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import {
  MAX_VISIBLE, SWATCHES, TEMPLATES, VARIABLES, colorOpen, fillSample, isHex, parseNews, unbalanced, visibleText, wrapSelection,
} from '../gameNews';
import { Field, errText, toast } from '../ui';

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
export function NewsPreview({ text, welcome = false }: { text: string; welcome?: boolean }) {
  useI18n();
  const shown = useMemo(() => fillSample(text, welcome), [text, welcome]);
  const has = useMemo(() => parseNews(shown).length > 0, [shown]);
  return (
    <div className="panel space-y-3 p-5">
      <h3 className="font-extrabold">{t('gn.preview')}</h3>
      <div className="rounded-xl p-4 font-semibold" style={{ background: '#15121c', color: '#e8e3f0' }} aria-live="polite">
        <div className="mb-1 text-xs font-bold uppercase tracking-wide" style={{ color: '#8f86a3' }}>{t('gn.chatLabel')}</div>
        {has ? <p className="wrap-break-word"><Styled text={shown} /></p> : <p style={{ color: '#8f86a3' }}>{t('gn.previewEmpty')}</p>}
      </div>
      <p className="text-sm font-semibold text-mute">{t('gn.previewNote')}</p>
    </div>
  );
}

/** a text box with a toolbar: colours, bold, italic, templates and a length counter */
export function NewsEditor({ value, onChange, templates = true, label, vars = VARIABLES, onCtrlEnter }: { value: string; onChange: (v: string) => void; templates?: boolean; label?: string; vars?: readonly string[]; onCtrlEnter?: () => void }) {
  useI18n();
  const [custom, setCustom] = useState('#FF8A00');
  const area = useRef<HTMLTextAreaElement>(null);
  const visible = visibleText(value).trim().length;

  const [mine, setMine] = useState<{ id: number; name: string; text: string }[]>([]);

  const wrap = (open: string, close: string) => {
    const el = area.current;
    const r = wrapSelection(value, el?.selectionStart ?? value.length, el?.selectionEnd ?? value.length, open, close);
    onChange(r.text);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(r.start, r.end); });
  };
  // puts text at the cursor (or over the selection)
  const insert = (s: string) => {
    const el = area.current;
    const a = el?.selectionStart ?? value.length;
    const b = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, a) + s + value.slice(b));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + s.length, a + s.length); });
  };

  const loadMine = useCallback(() => api<{ id: number; name: string; text: string }[]>('/game-news/templates').then(setMine).catch(() => undefined), []);
  useEffect(() => { if (templates) void loadMine(); }, [templates, loadMine]);
  const saveAsTemplate = async () => {
    const name = await promptDialog({ title: t('gn.tpl.saveTitle'), label: t('gn.tpl.name'), placeholder: t('gn.tpl.nameEx'), confirmLabel: t('common.save') });
    if (!name?.trim()) return;
    try { await api('/game-news/templates', 'POST', { name: name.trim(), text: value }); toast(t('gn.tpl.saved')); void loadMine(); } catch (e) { toast(errText(e), 'err'); }
  };
  const removeTemplate = async (x: { id: number; name: string }) => {
    if (!(await confirmDialog({ title: t('gn.tpl.delTitle', { name: x.name }), danger: true, confirmLabel: t('gn.a.del') }))) return;
    try { await api(`/game-news/templates/${x.id}`, 'DELETE'); void loadMine(); } catch (e) { toast(errText(e), 'err'); }
  };

  return (
    <div className="space-y-4">
      {templates && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('gn.templates')}>
          <span className="text-sm font-bold text-mute">{t('gn.templates')}:</span>
          {TEMPLATES.map((x) => (
            <button key={x.id} type="button" className="chip-filter" onClick={() => onChange(x.text(t('gn.tpl.when')))}>{t(`gn.tpl.${x.id}` as 'gn.tpl.restart')}</button>
          ))}
          {mine.map((x) => (
            <span key={x.id} className="inline-flex items-center gap-1">
              <button type="button" className="chip-filter" onClick={() => onChange(x.text)}>{x.name}</button>
              <button type="button" className="row-act" aria-label={t('gn.tpl.delAria', { name: x.name })} onClick={() => void removeTemplate(x)}>✕</button>
            </span>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" disabled={!value.trim()} onClick={() => void saveAsTemplate()}>{t('gn.tpl.save')}</button>
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
          onKeyDown={(e) => { if (onCtrlEnter && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onCtrlEnter(); } }}
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

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('gn.vars')}>
        <span className="text-sm font-bold text-mute">{t('gn.vars')}:</span>
        {vars.map((v) => (
          <button key={v} type="button" className="chip-filter font-mono" title={t(`gn.v.${v}` as 'gn.v.server')} onClick={() => insert(`{${v}}`)}>{`{${v}}`}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-mute">
        <span className={visible > MAX_VISIBLE ? 'text-danger' : undefined}>{t('gn.counter', { n: visible, max: MAX_VISIBLE })}</span>
        {unbalanced(value) && <span>{t('gn.unbalanced')}</span>}
      </div>
    </div>
  );
}
