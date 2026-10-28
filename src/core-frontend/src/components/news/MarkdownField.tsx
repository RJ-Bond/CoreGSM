import { memo, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { NewsVariable } from '../../api';
import { t, useI18n } from '../../i18n';
import { searchEmoji } from './emoji';

const EMOJIS = ['📢', '📣', '🔔', '🎉', '🎊', '🎁', '🏆', '🥇', '⭐', '🌟', '✨', '🔥', '💥', '⚡', '🚀', '🆕', '✅', '❌', '⚠️', '❗', '❓', '🛠️', '🔧', '⚙️', '🧹', '🗑️', '📅', '🗓️', '⏰', '🕒', '⏳', '📍', '🌍', '🗺️', '🎮', '🕹️', '👑', '⚔️', '🛡️', '🏹', '💎', '💰', '🪙', '❤️', '💜', '💙', '💚', '👍', '👏', '🙌', '🤝', '💬', '📝', '📌', '🔗', '🖼️', '🎤', '🎧', '📈', '🟢', '🟡', '🔴', '🔵'];

export function Counter({ value, max }: { value: number; max: number }) {
  useI18n();
  const over = value > max;
  const near = !over && value > max * 0.9;
  return <span className={`text-xs font-bold tabular-nums ${over ? 'text-bad' : near ? 'text-warn' : 'text-mute'}`} aria-label={t('d2.md.chars', { value, max })}>{value}/{max}</span>;
}

const Btn = ({ onClick, title, children, on }: { onClick: () => void; title: string; children: ReactNode; on?: boolean }) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={on}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    className="btn-ghost btn-xs min-w-8"
  >
    {children}
  </button>
);

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  rows?: number;
  placeholder?: string;
  /** a short field (field value): fewer toolbar buttons */
  compact?: boolean;
  variables?: NewsVariable[];
  /** an image was pasted from the clipboard */
  onImage?: (file: File) => void;
  hideLabel?: boolean;
}

/** Text area with a Discord-markdown toolbar, shortcuts (Ctrl+B/I/U/K), `:name` emoji autocomplete and smart paste. */
function MarkdownFieldImpl({ id, label, value, onChange, max, rows = 6, placeholder, compact, variables, onImage, hideLabel }: Props) {
  useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [panel, setPanel] = useState<'' | 'emoji' | 'vars'>('');
  const [sug, setSug] = useState<{ start: number; end: number; items: [string, string][]; idx: number } | null>(null);

  const apply = (text: string, selStart: number, selEnd: number) => {
    onChange(text);
    const ta = ref.current;
    requestAnimationFrame(() => { ta?.focus(); ta?.setSelectionRange(selStart, selEnd); });
  };

  const wrap = (mark: string, ph = t('d2.md.text')) => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = value.slice(s, e);
    const before = value.slice(0, s), after = value.slice(e);
    // toggle: already wrapped -> unwrap
    if (sel && before.endsWith(mark) && after.startsWith(mark)) {
      apply(before.slice(0, -mark.length) + sel + after.slice(mark.length), s - mark.length, e - mark.length);
      return;
    }
    const inner = sel || ph;
    apply(before + mark + inner + mark + after, s + mark.length, s + mark.length + inner.length);
  };

  /** line-based formats: the selection grows to whole lines */
  const prefixLines = (prefix: string, ph = t('d2.md.text')) => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const ls = value.lastIndexOf('\n', s - 1) + 1;
    let le = value.indexOf('\n', e);
    if (le === -1) le = value.length;
    const block = value.slice(ls, le) || ph;
    const lines = block.split('\n');
    const all = lines.every((l) => l.startsWith(prefix));
    const out = (all ? lines.map((l) => l.slice(prefix.length)) : lines.map((l) => prefix + l.replace(/^(#{1,3}\s+|-#\s+|>\s?)/, ''))).join('\n');
    apply(value.slice(0, ls) + out + value.slice(le), ls, ls + out.length);
  };

  const numbered = () => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const ls = value.lastIndexOf('\n', s - 1) + 1;
    let le = value.indexOf('\n', e);
    if (le === -1) le = value.length;
    const lines = (value.slice(ls, le) || t('d2.md.item')).split('\n');
    const out = lines.map((l, i) => `${i + 1}. ${l.replace(/^\d+\.\s+/, '')}`).join('\n');
    apply(value.slice(0, ls) + out + value.slice(le), ls, ls + out.length);
  };

  const codeBlock = () => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const inner = value.slice(s, e) || t('d2.md.code');
    const pre = s > 0 && value[s - 1] !== '\n' ? '\n' : '';
    const text = `${value.slice(0, s)}${pre}\`\`\`\n${inner}\n\`\`\`${value.slice(e)}`;
    const a = s + pre.length + 4;
    apply(text, a, a + inner.length);
  };

  const link = () => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = value.slice(s, e);
    if (/^https?:\/\/\S+$/.test(sel)) {
      const word = t('d2.md.linkWord');
      const text = `${value.slice(0, s)}[${word}](${sel})${value.slice(e)}`;
      apply(text, s + 1, s + 1 + word.length);
      return;
    }
    const lbl = sel || t('d2.md.linkText');
    const text = `${value.slice(0, s)}[${lbl}](https://)${value.slice(e)}`;
    const st = s + lbl.length + 3;
    apply(text, st, st + 8);
  };

  const insert = (tok: string) => {
    const ta = ref.current;
    const s = ta?.selectionStart ?? value.length;
    const e = ta?.selectionEnd ?? value.length;
    apply(value.slice(0, s) + tok + value.slice(e), s + tok.length, s + tok.length);
  };

  const detect = (text: string, caret: number) => {
    const m = /(?:^|[\s(])(:[\p{L}\p{N}_+-]{2,})$/u.exec(text.slice(0, caret));
    if (!m) return setSug(null);
    const items = searchEmoji(m[1]);
    setSug(items.length ? { start: caret - m[1].length, end: caret, items, idx: 0 } : null);
  };

  const accept = (emoji: string) => {
    if (!sug) return;
    apply(value.slice(0, sug.start) + emoji + value.slice(sug.end), sug.start + emoji.length, sug.start + emoji.length);
    setSug(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sug) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSug({ ...sug, idx: (sug.idx + 1) % sug.items.length }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSug({ ...sug, idx: (sug.idx - 1 + sug.items.length) % sug.items.length }); return; }
      if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') { e.preventDefault(); accept(sug.items[sug.idx][0]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSug(null); return; }
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      // by physical key: works in the Russian layout too (Ctrl+Z stays native undo)
      if (e.code === 'KeyB') { e.preventDefault(); wrap('**'); }
      else if (e.code === 'KeyI') { e.preventDefault(); wrap('*'); }
      else if (e.code === 'KeyU') { e.preventDefault(); wrap('__'); }
      else if (e.code === 'KeyK') { e.preventDefault(); link(); }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const cd = e.clipboardData;
    if (onImage) {
      const file = Array.from(cd.files).find((f) => f.type.startsWith('image/'));
      if (file) { e.preventDefault(); onImage(file); return; }
    }
    const text = cd.getData('text').trim();
    const ta = e.currentTarget;
    const s = ta.selectionStart, en = ta.selectionEnd;
    if (s !== en && /^https?:\/\/\S+$/.test(text)) {
      e.preventDefault();
      const sel = value.slice(s, en);
      const out = `[${sel}](${text})`;
      apply(value.slice(0, s) + out + value.slice(en), s + out.length, s + out.length);
    }
  };

  const onInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    detect(e.target.value, e.target.selectionStart);
  };

  return (
    <div>
      <div className={`mb-1.5 flex items-center justify-between ${hideLabel ? 'sr-only' : ''}`}>
        <label htmlFor={id} className="label mb-0!">{label}</label>
        <Counter value={value.length} max={max} />
      </div>
      <div className="flash-host relative rounded-2xl border-2 border-line focus-within:border-brand">
        <div className="flex flex-wrap items-center gap-0.5 border-b-2 border-line px-1.5 py-1" role="toolbar" aria-label={t('d2.md.formatting', { label })}>
          <Btn onClick={() => wrap('**')} title={t('d2.md.bold')}><b>{t('d2.md.bold.k')}</b></Btn>
          <Btn onClick={() => wrap('*')} title={t('d2.md.italic')}><i>{t('d2.md.italic.k')}</i></Btn>
          <Btn onClick={() => wrap('__')} title={t('d2.md.underline')}><u>{t('d2.md.underline.k')}</u></Btn>
          <Btn onClick={() => wrap('~~')} title={t('d2.md.strike')}><s>{t('d2.md.strike.k')}</s></Btn>
          <Btn onClick={() => wrap('||')} title={t('d2.md.spoiler')}>▒</Btn>
          <Btn onClick={() => wrap('`', t('d2.md.code'))} title={t('d2.md.inlineCode')}><span className="font-mono">{'<>'}</span></Btn>
          {!compact && <Btn onClick={codeBlock} title={t('d2.md.codeBlock')}><span className="font-mono text-xs">{'```'}</span></Btn>}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          {!compact && (
            <>
              <Btn onClick={() => prefixLines('# ', t('d2.md.heading'))} title={t('d2.md.h1')}><span className="text-xs">H1</span></Btn>
              <Btn onClick={() => prefixLines('## ', t('d2.md.heading'))} title={t('d2.md.h2')}><span className="text-xs">H2</span></Btn>
              <Btn onClick={() => prefixLines('### ', t('d2.md.heading'))} title={t('d2.md.h3')}><span className="text-xs">H3</span></Btn>
              <Btn onClick={() => prefixLines('-# ')} title={t('d2.md.small')}><span className="text-xs">-#</span></Btn>
            </>
          )}
          <Btn onClick={() => prefixLines('> ')} title={t('d2.md.quote')}>❝</Btn>
          <Btn onClick={() => prefixLines('- ')} title={t('d2.md.bullets')}>•≡</Btn>
          {!compact && <Btn onClick={numbered} title={t('d2.md.numbers')}><span className="text-xs">1.</span></Btn>}
          <Btn onClick={link} title={t('d2.md.link')}>🔗</Btn>
          <Btn onClick={() => setPanel((v) => (v === 'emoji' ? '' : 'emoji'))} title={t('d2.md.emoji')} on={panel === 'emoji'}>😀</Btn>
          {variables && variables.length > 0 && (
            <Btn onClick={() => setPanel((v) => (v === 'vars' ? '' : 'vars'))} title={t('d2.md.variable')} on={panel === 'vars'}><span className="font-mono text-xs">{'{ }'}</span></Btn>
          )}
        </div>
        {panel === 'emoji' && (
          <div className="absolute right-0 top-11 z-20 grid w-72 max-w-[85vw] grid-cols-8 gap-0.5 rounded-2xl bg-card p-2 shadow-soft ring-2 ring-line">
            {EMOJIS.map((e) => (
              <button key={e} type="button" aria-label={t('d2.md.emojiN', { e })} className="grid h-8 w-8 place-items-center rounded-lg text-lg hover:bg-soft" onClick={() => { insert(e); setPanel(''); }}>{e}</button>
            ))}
          </div>
        )}
        {panel === 'vars' && variables && (
          <div className="absolute right-0 top-11 z-20 max-h-72 w-80 max-w-[85vw] overflow-auto rounded-2xl bg-card p-1.5 shadow-soft ring-2 ring-line" role="menu" aria-label={t('d2.md.variables')}>
            {variables.map((v) => (
              <button key={v.token} type="button" role="menuitem" className="block w-full rounded-xl px-3 py-2 text-left hover:bg-soft" onClick={() => { insert(v.token); setPanel(''); }}>
                <span className="block font-mono text-sm font-bold">{v.token}</span>
                <span className="block text-xs font-semibold text-mute">{v.description}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          id={id}
          ref={ref}
          rows={rows}
          value={value}
          onChange={onInput}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onClick={(e) => detect(value, e.currentTarget.selectionStart)}
          onBlur={() => setTimeout(() => setSug(null), 120)}
          placeholder={placeholder}
          aria-autocomplete={sug ? 'list' : undefined}
          aria-controls={sug ? `${id}-sug` : undefined}
          className="w-full resize-y rounded-b-2xl bg-card px-3.5 py-2.5 font-semibold text-ink placeholder:font-normal placeholder:text-mute/80 focus:outline-hidden"
        />
        {sug && (
          <ul id={`${id}-sug`} role="listbox" aria-label={t('d2.md.emojiHints')} className="absolute left-2 top-full z-30 mt-1 w-64 max-w-[85vw] overflow-hidden rounded-2xl bg-card p-1 shadow-soft ring-2 ring-line">
            {sug.items.map(([em, names], i) => (
              <li key={`${em}-${i}`} role="option" aria-selected={i === sug.idx}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => { e.preventDefault(); accept(em); }}
                  className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left ${i === sug.idx ? 'bg-soft' : ''}`}
                >
                  <span className="text-lg">{em}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-mute">{names.split(' ').slice(0, 2).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export const MarkdownField = memo(MarkdownFieldImpl);
