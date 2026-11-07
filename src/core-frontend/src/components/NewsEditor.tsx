import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { api } from '../api';
import { confirmDialog, promptDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import {
  MAX_BYTES, MAX_VISIBLE, SWATCHES, TEMPLATES, VARIABLES, byteLength, colorOpen, fillSample, isHex, parseNews, unbalanced, visibleText, wrapSelection,
} from '../gameNews';
import { readFrom, renderInto } from '../richNews';
import { Field, errText, toast } from '../ui';

const swatchName = (id: string) => t(`gn.c.${id}` as 'gn.c.info');
// a click on a toolbar button must not take the selection out of the text
const keep = (e: MouseEvent) => e.preventDefault();

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

/** the colour the game gives to a chat line that has no colour of its own (taken from a screenshot of the game) */
export const GAME_ORANGE = '#E8982B';

/** lines as the in-game chat draws them: «[15:14] [СИСТЕМА] text»; a text without a colour is orange */
export function ChatLines({ lines }: { lines: string[] }) {
  useI18n();
  const time = useMemo(() => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), []);
  return (
    <div
      className="rounded-xl p-4 text-base font-semibold leading-snug"
      style={{ background: 'linear-gradient(180deg, #1f2d33, #0f171b)', color: GAME_ORANGE, textShadow: '0 1px 2px rgba(0, 0, 0, .85)' }}
      aria-live="polite"
    >
      {lines.length === 0 && <p style={{ color: '#8f9aa0', textShadow: 'none' }}>{t('gn.previewEmpty')}</p>}
      {lines.map((l, i) => (
        <p key={i} className="wrap-break-word">[{time}] [{t('gn.chatSystem')}] <Styled text={l} /></p>
      ))}
    </div>
  );
}

/** how a message looks in the in-game chat (approximate: the colours are exact, the font and background are not) */
export function NewsPreview({ text, welcome = false }: { text: string; welcome?: boolean }) {
  useI18n();
  const shown = useMemo(() => fillSample(text, welcome), [text, welcome]);
  const has = useMemo(() => parseNews(shown).length > 0, [shown]);
  return (
    <div className="panel space-y-3 p-5 self-start">
      <h3 className="font-extrabold">{t('gn.preview')}</h3>
      <ChatLines lines={has ? [shown] : []} />
      <p className="text-sm font-semibold text-mute">{t('gn.previewNote')}</p>
    </div>
  );
}

/**
 * The editor of a game message. The box shows colours, bold and italic as they look (select a word, press a colour);
 * the saved text keeps the tags. «Код» switches to the plain text with the tags for those who want them.
 */
export function NewsEditor({ value, onChange, templates = true, label, vars = VARIABLES, onCtrlEnter }: { value: string; onChange: (v: string) => void; templates?: boolean; label?: string; vars?: readonly string[]; onCtrlEnter?: () => void }) {
  useI18n();
  const [custom, setCustom] = useState('#FF8A00');
  const [raw, setRaw] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // the last text the visual box produced: a different `value` comes from outside (a template, «use again») and is drawn
  const lastOut = useRef<string | null>(null);
  const visible = visibleText(value).trim().length;
  const bytes = byteLength(value);
  const [mine, setMine] = useState<{ id: number; name: string; text: string }[]>([]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || raw || value === lastOut.current) return;
    renderInto(el, value);
    lastOut.current = value;
  }, [value, raw]);

  const emit = () => {
    const el = box.current;
    if (!el) return;
    const s = readFrom(el);
    if (!s) el.textContent = ''; // the browser leaves a stray <br> in an emptied box
    lastOut.current = s;
    onChange(s);
  };
  const run = (cmd: string, arg?: string) => {
    const el = box.current;
    if (!el) return;
    el.focus();
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* old browser: <font> is read as well */ }
    document.execCommand(cmd, false, arg);
    emit();
  };

  // raw mode: tags around the selection of the text area
  const wrap = (open: string, close: string) => {
    const el = area.current;
    const r = wrapSelection(value, el?.selectionStart ?? value.length, el?.selectionEnd ?? value.length, open, close);
    onChange(r.text);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(r.start, r.end); });
  };
  const insertRaw = (s: string) => {
    const el = area.current;
    const a = el?.selectionStart ?? value.length;
    const b = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, a) + s + value.slice(b));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + s.length, a + s.length); });
  };

  const colorize = (hex: string) => (raw ? wrap(colorOpen(hex), '</color>') : run('foreColor', hex));
  const bold = () => (raw ? wrap('<b>', '</b>') : run('bold'));
  const italic = () => (raw ? wrap('<i>', '</i>') : run('italic'));
  const clearStyle = () => (raw ? onChange(visibleText(value)) : run('removeFormat'));
  const insertVar = (s: string) => (raw ? insertRaw(s) : run('insertText', s));
  const toggleRaw = () => { lastOut.current = null; setRaw((r) => !r); };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // the chat is one line
    if (onCtrlEnter && (e.ctrlKey || e.metaKey)) onCtrlEnter();
  };
  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/[\r\n]+/g, ' '));
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
        {raw ? (
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
        ) : (
          <div
            ref={box}
            role="textbox"
            tabIndex={0}
            aria-multiline="false"
            aria-label={label ?? t('gn.message')}
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            data-placeholder={t('gn.placeholder')}
            className="input rich-box min-h-32 text-sm"
            onInput={emit}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
        )}
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
            onMouseDown={keep}
            onClick={() => colorize(s.hex)}
          />
        ))}
        <input className="input w-28 font-mono text-sm" value={custom} maxLength={7} aria-label={t('gn.customHex')} onChange={(e) => setCustom(e.target.value)} />
        <button type="button" className="btn btn-soft btn-sm" disabled={!isHex(custom)} onMouseDown={keep} onClick={() => colorize(custom)}>{t('gn.applyHex')}</button>
        <button type="button" className="btn btn-soft btn-sm font-black" onMouseDown={keep} onClick={bold} aria-label={t('gn.bold')}>B</button>
        <button type="button" className="btn btn-soft btn-sm italic" onMouseDown={keep} onClick={italic} aria-label={t('gn.italic')}>I</button>
        <button type="button" className="btn btn-ghost btn-sm" onMouseDown={keep} onClick={clearStyle}>{t('gn.clearTags')}</button>
        <button type="button" className="btn btn-ghost btn-sm ml-auto font-mono" aria-pressed={raw} onClick={toggleRaw}>{raw ? t('gn.rawOff') : t('gn.rawOn')}</button>
      </div>

      <details className="text-sm font-semibold text-mute">
        <summary className="cursor-pointer">{t('gn.cg.title')}</summary>
        <ul className="mt-2 grid gap-1.5 min-[520px]:grid-cols-2">
          {SWATCHES.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-line" style={{ background: c.hex }} aria-hidden />
              <span><b>{swatchName(c.id)}</b>: {t(`gn.cg.${c.id}` as 'gn.cg.info')}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2">{t('gn.cg.default')}</p>
      </details>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('gn.vars')}>
        <span className="text-sm font-bold text-mute">{t('gn.vars')}:</span>
        {vars.map((v) => (
          <button key={v} type="button" className="chip-filter font-mono" title={t(`gn.v.${v}` as 'gn.v.server')} onMouseDown={keep} onClick={() => insertVar(`{${v}}`)}>{`{${v}}`}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-mute">
        <span className={visible > MAX_VISIBLE || bytes > MAX_BYTES ? 'text-danger' : undefined}>
          {t('gn.counter', { n: visible, max: MAX_VISIBLE })}
          {bytes > MAX_BYTES * 0.6 && <> · {t('gn.bytes', { n: bytes, max: MAX_BYTES })}</>}
        </span>
        {unbalanced(value) && <span>{t('gn.unbalanced')}</span>}
      </div>
    </div>
  );
}
