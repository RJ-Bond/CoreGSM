import { createContext, Fragment, useContext, useState, type ReactNode } from 'react';
import { t, t as tr } from '../../i18n';
import { toast } from '../../ui';

/**
 * Discord markdown for the message preview, in Discord's own dark and light colours:
 * **bold** *italic* __underline__ ~~strike~~ ||spoiler|| `code` ```blocks``` [text](url) # headings -# small text
 * > quotes, lists, @everyone/@here, <@&role>, <@user>, <#channel>, <t:unix:R> and custom emoji.
 */

/** the «#» that appears beside a heading on hover and copies the link to that part of the page */
function HeadingAnchor({ id }: { id: string }) {
  // in the editor preview the link would point at the editor: no anchor there
  if (typeof window === 'undefined' || !/^\/news\/\d+/.test(window.location.pathname)) return null;
  const copy = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    try { await navigator.clipboard.writeText(url); toast(t('nw.anchorCopied')); } catch { /* no clipboard */ }
    window.history.replaceState(null, '', `#${id}`);
  };
  return <button type="button" className="nw-anchor" onClick={() => void copy()} aria-label={t('nw.anchorCopy')} title={t('nw.anchorCopy')}>#</button>;
}

export interface DTheme {
  name: 'dark' | 'light';
  outer: string;
  embed: string;
  embedBorder: string;
  text: string;
  title: string;
  muted: string;
  link: string;
  code: string;
  quote: string;
  spoilerHide: string;
  spoilerShow: string;
  mentionBg: string;
  mentionFg: string;
  chipBg: string;
}

export const THEMES: Record<'dark' | 'light', DTheme> = {
  dark: {
    name: 'dark', outer: '#313338', embed: '#2b2d31', embedBorder: '#1e1f22', text: '#dbdee1', title: '#ffffff', muted: '#949ba4', link: '#00a8fc',
    code: '#1e1f22', quote: '#4e5058', spoilerHide: '#1e1f22', spoilerShow: 'rgba(255,255,255,0.1)', mentionBg: 'rgba(88,101,242,0.3)', mentionFg: '#c9cdfb', chipBg: 'rgba(78,80,88,0.6)',
  },
  light: {
    name: 'light', outer: '#ffffff', embed: '#f2f3f5', embedBorder: '#e3e5e8', text: '#313338', title: '#060607', muted: '#5c5e66', link: '#006ce7',
    code: '#e3e5e8', quote: '#c4c9ce', spoilerHide: '#c4c9ce', spoilerShow: 'rgba(0,0,0,0.08)', mentionBg: 'rgba(88,101,242,0.15)', mentionFg: '#505cdc', chipBg: 'rgba(116,127,141,0.2)',
  },
};

export const ThemeCtx = createContext<DTheme>(THEMES.dark);

export interface MdEnv {
  /** names of channels by id for <#id> */
  channelName?: (id: string) => string | undefined;
}
export const EnvCtx = createContext<MdEnv>({});

// ---------- timestamps ----------
const RTF = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl ? new Intl.RelativeTimeFormat('ru', { numeric: 'auto' }) : null;

export function formatTimestamp(unix: number, style: string, now = Date.now()): string {
  const d = new Date(unix * 1000);
  if (Number.isNaN(d.getTime())) return String(unix);
  const o = (opts: Intl.DateTimeFormatOptions) => d.toLocaleString('ru-RU', opts);
  switch (style) {
    case 't': return o({ hour: '2-digit', minute: '2-digit' });
    case 'T': return o({ hour: '2-digit', minute: '2-digit', second: '2-digit' });
    case 'd': return o({ day: '2-digit', month: '2-digit', year: 'numeric' });
    case 'D': return o({ day: 'numeric', month: 'long', year: 'numeric' });
    case 'F': return o({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    case 'R': {
      const diff = Math.round((d.getTime() - now) / 1000);
      const a = Math.abs(diff);
      const [v, unit]: [number, Intl.RelativeTimeFormatUnit] =
        a < 60 ? [diff, 'second'] : a < 3600 ? [Math.round(diff / 60), 'minute'] : a < 86400 ? [Math.round(diff / 3600), 'hour']
          : a < 30 * 86400 ? [Math.round(diff / 86400), 'day'] : a < 365 * 86400 ? [Math.round(diff / (30 * 86400)), 'month'] : [Math.round(diff / (365 * 86400)), 'year'];
      return RTF ? RTF.format(v, unit) : `${v} ${unit}`;
    }
    default: return o({ day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}

// ---------- inline ----------
const INLINE = new RegExp(
  '(' + [
    '`[^`\\n]+`',
    '\\[[^\\]\\n]+\\]\\(<?https?:\\/\\/[^)\\s>]+>?(?:\\s+"[^"\\n]*")?\\)',
    '<t:-?\\d+(?::[tTdDfFR])?>',
    '<a?:\\w+:\\d+>',
    '<@&\\d+>',
    '<@!?\\d+>',
    '<#\\d+>',
    '@everyone',
    '@here',
    '\\*\\*[^\\n]+?\\*\\*',
    '__[^\\n]+?__',
    '~~[^\\n]+?~~',
    '\\|\\|[^\\n]+?\\|\\|',
    '\\*[^*\\n]+\\*',
    '_[^_\\n]+_',
    'https?:\\/\\/[^\\s<>]+',
  ].join('|') + ')',
  'g',
);

function Spoiler({ children }: { children: ReactNode }) {
  const t = useContext(ThemeCtx);
  const [open, setOpen] = useState(false);
  return (
    <span
      data-spoiler
      role="button"
      tabIndex={0}
      aria-label={open ? undefined : tr('d2.dm.spoiler')}
      onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); } }}
      className="cursor-pointer rounded-sm px-0.5"
      style={{ background: open ? t.spoilerShow : t.spoilerHide, color: open ? 'inherit' : 'transparent' }}
    >
      {children}
    </span>
  );
}

function Chip({ children, kind }: { children: ReactNode; kind: 'mention' | 'time' }) {
  const t = useContext(ThemeCtx);
  return (
    <span
      className="whitespace-nowrap rounded-sm px-[3px] font-medium"
      style={kind === 'mention' ? { background: t.mentionBg, color: t.mentionFg } : { background: t.chipBg }}
    >
      {children}
    </span>
  );
}

function TimeChip({ unix, style }: { unix: number; style: string }) {
  return (
    <Chip kind="time">
      <span title={`${new Date(unix * 1000).toLocaleString('ru-RU')} (<t:${unix}:${style}>)`}>{formatTimestamp(unix, style)}</span>
    </Chip>
  );
}

function ChannelChip({ id }: { id: string }) {
  const env = useContext(EnvCtx);
  return <Chip kind="mention">#{env.channelName?.(id) ?? t('d2.sd.channel')}</Chip>;
}

export function inlineMd(text: string, depth = 0): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    const k = `${depth}-${i}`;
    if (i % 2 === 0) return <Fragment key={k}>{part}</Fragment>;
    if (part.startsWith('`') && part.length > 2) return <InlineCode key={k}>{part.slice(1, -1)}</InlineCode>;
    const link = /^\[([^\]]+)\]\(<?(https?:\/\/[^)\s>]+)>?(?:\s+"[^"]*")?\)$/.exec(part);
    if (link) return <Link key={k} href={link[2]}>{depth < 3 ? inlineMd(link[1], depth + 1) : link[1]}</Link>;
    const ts = /^<t:(-?\d+)(?::([tTdDfFR]))?>$/.exec(part);
    if (ts) return <TimeChip key={k} unix={Number(ts[1])} style={ts[2] ?? 'f'} />;
    const emo = /^<(a?):(\w+):(\d+)>$/.exec(part);
    if (emo) return <img key={k} src={`https://cdn.discordapp.com/emojis/${emo[3]}.${emo[1] ? 'gif' : 'png'}?size=48`} alt={`:${emo[2]}:`} title={`:${emo[2]}:`} className="inline-block h-[1.3em] w-[1.3em] align-text-bottom" />;
    if (part === '@everyone' || part === '@here') return <Chip key={k} kind="mention">{part}</Chip>;
    if (part.startsWith('<@&')) return <Chip key={k} kind="mention">@{t('d2.dm.role')}</Chip>;
    if (part.startsWith('<@')) return <Chip key={k} kind="mention">@{t('d2.dm.member')}</Chip>;
    const ch = /^<#(\d+)>$/.exec(part);
    if (ch) return <ChannelChip key={k} id={ch[1]} />;
    if (depth < 3) {
      if (/^\*\*.+\*\*$/.test(part)) return <strong key={k}>{inlineMd(part.slice(2, -2), depth + 1)}</strong>;
      if (/^__.+__$/.test(part)) return <u key={k}>{inlineMd(part.slice(2, -2), depth + 1)}</u>;
      if (/^~~.+~~$/.test(part)) return <s key={k}>{inlineMd(part.slice(2, -2), depth + 1)}</s>;
      if (/^\|\|.+\|\|$/.test(part)) return <Spoiler key={k}>{inlineMd(part.slice(2, -2), depth + 1)}</Spoiler>;
      if (/^\*[^*]+\*$/.test(part) || /^_[^_]+_$/.test(part)) return <em key={k}>{inlineMd(part.slice(1, -1), depth + 1)}</em>;
    }
    if (/^https?:\/\//.test(part)) return <Link key={k} href={part} wrap>{part}</Link>;
    return <Fragment key={k}>{part}</Fragment>;
  });
}

function InlineCode({ children }: { children: ReactNode }) {
  const t = useContext(ThemeCtx);
  return <code style={{ background: t.code, borderRadius: 4, padding: '1px 5px', fontSize: '0.88em' }} className="font-mono">{children}</code>;
}

function Link({ href, children, wrap }: { href: string; children: ReactNode; wrap?: boolean }) {
  const t = useContext(ThemeCtx);
  return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: t.link }} className={`hover:underline ${wrap ? 'break-all' : ''}`}>{children}</a>;
}

// ---------- blocks ----------
export function DiscordMd({ text }: { text: string }) {
  const t = useContext(ThemeCtx);
  const out: ReactNode[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      const body: string[] = [];
      const first = line.trim().slice(3);
      // ```js on the first line is the language: not shown; a single-line ```code``` is kept as text
      const single = /^(.*)```$/.exec(first);
      if (single) {
        body.push(single[1]);
      } else {
        if (first && !/\s/.test(first)) { /* language tag */ } else if (first) body.push(first);
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
      }
      out.push(<CodeBlock key={i} text={body.join('\n')} background={t.code} border={t.embedBorder} />);
      continue;
    }
    if (line.startsWith('>>> ')) {
      out.push(<Quote key={i}><div className="whitespace-pre-wrap">{inlineMd([line.slice(4), ...lines.slice(i + 1)].join('\n'))}</div></Quote>);
      break;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      let j = i;
      while (j < lines.length && /^>\s?/.test(lines[j]) && !lines[j].startsWith('>>> ')) q.push(lines[j++].replace(/^>\s?/, ''));
      out.push(<Quote key={i}>{q.map((l, n) => <div key={n}>{inlineMd(l)}</div>)}</Quote>);
      i = j - 1;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const size = h[1].length === 1 ? 'text-[1.5em]' : h[1].length === 2 ? 'text-[1.25em]' : 'text-[1.1em]';
      // the id lets the table of contents of the news page jump here (extractHeadings builds the same ids)
      out.push(
        <div key={i} id={`nw-h-${i}`} role="heading" aria-level={h[1].length} className={`${size} nw-h mb-0.5 mt-1.5 font-bold leading-tight`} style={{ color: t.title }}>
          {inlineMd(h[2])}
          <HeadingAnchor id={`nw-h-${i}`} />
        </div>,
      );
      continue;
    }
    const small = /^-#\s+(.*)$/.exec(line);
    if (small) {
      out.push(<div key={i} className="text-[0.8em]" style={{ color: t.muted }}>{inlineMd(small[1])}</div>);
      continue;
    }
    const li = /^(\s*)[-*•]\s+(.*)$/.exec(line);
    if (li) {
      const lvl = Math.min(2, Math.floor(li[1].length / 2));
      out.push(<div key={i} className="flex gap-2" style={{ paddingLeft: 8 + lvl * 16 }}><span aria-hidden>{lvl ? '◦' : '•'}</span><span className="min-w-0">{inlineMd(li[2])}</span></div>);
      continue;
    }
    const ol = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
    if (ol) {
      out.push(<div key={i} className="flex gap-1.5" style={{ paddingLeft: 8 + Math.min(2, Math.floor(ol[1].length / 2)) * 16 }}><span aria-hidden className="tabular-nums">{ol[2]}.</span><span className="min-w-0">{inlineMd(ol[3])}</span></div>);
      continue;
    }
    out.push(line.trim() === '' ? <div key={i} className="h-[0.6em]" /> : <div key={i}>{inlineMd(line)}</div>);
  }
  return <div className="wrap-break-word leading-snug">{out}</div>;
}

function Quote({ children }: { children: ReactNode }) {
  const t = useContext(ThemeCtx);
  return <div className="my-0.5 pl-3" style={{ borderLeft: `4px solid ${t.quote}` }}>{children}</div>;
}

function CodeBlock({ text, background, border }: { text: string; background: string; border: string }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast(t('nw.codeCopied')); } catch { toast(t('nw.copyFail'), 'err'); }
  };
  return (
    <div className="nw-code">
      <pre className="my-1 overflow-x-auto whitespace-pre-wrap rounded-md border p-2 font-mono text-fs-sm" style={{ background, borderColor: border }}>{text}</pre>
      <button type="button" className="nw-code-copy" onClick={() => void copy()} aria-label={t('nw.codeCopy')} title={t('nw.codeCopy')}>{t('nw.codeCopy')}</button>
    </div>
  );
}
