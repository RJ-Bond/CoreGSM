import { Fragment, useState, type ReactNode } from 'react';
import { ago } from '../ui';

/**
 * The subset of Discord markdown used in embeds, rendered the way Discord shows it:
 * **bold**, *italic*, __underline__, ~~strike~~, ||spoiler||, `code`, ```blocks```, [text](url),
 * > quotes, - lists, # headings and <t:unix:R> relative times.
 */

const D = { text: '#dbdee1', title: '#ffffff', code: '#1e1f22', link: '#00a8fc', quote: '#4e5058' };

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      onClick={() => setOpen(true)}
      className="cursor-pointer rounded-sm px-0.5"
      style={{ background: open ? 'rgba(255,255,255,0.1)' : '#1e1f22', color: open ? 'inherit' : 'transparent' }}
      title={open ? undefined : 'Спойлер: нажмите, чтобы показать'}
    >
      {children}
    </span>
  );
}

// order matters: longer markers first
const INLINE =
  /(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|`[^`\n]+`|\*\*[^\n]+?\*\*|__[^\n]+?__|~~[^\n]+?~~|\|\|[^\n]+?\|\||\*[^*\n]+\*|_[^_\n]+_|<t:\d+:R>|https?:\/\/[^\s<>]+)/g;

export function inlineMd(text: string, depth = 0): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    const k = `${depth}-${i}`;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={k} style={{ background: D.code, borderRadius: 4, padding: '1px 5px', fontSize: '0.92em' }}>{part.slice(1, -1)}</code>;
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (link) return <a key={k} href={link[2]} target="_blank" rel="noreferrer" style={{ color: D.link }} className="hover:underline">{inlineMd(link[1], depth + 1)}</a>;
    if (depth < 3) {
      if (/^\*\*.+\*\*$/.test(part)) return <strong key={k} style={{ color: D.title }}>{inlineMd(part.slice(2, -2), depth + 1)}</strong>;
      if (/^__.+__$/.test(part)) return <u key={k}>{inlineMd(part.slice(2, -2), depth + 1)}</u>;
      if (/^~~.+~~$/.test(part)) return <s key={k}>{inlineMd(part.slice(2, -2), depth + 1)}</s>;
      if (/^\|\|.+\|\|$/.test(part)) return <Spoiler key={k}>{inlineMd(part.slice(2, -2), depth + 1)}</Spoiler>;
      if (/^\*[^*]+\*$/.test(part) || /^_[^_]+_$/.test(part)) return <em key={k}>{inlineMd(part.slice(1, -1), depth + 1)}</em>;
    }
    const t = /^<t:(\d+):R>$/.exec(part);
    if (t) return <span key={k} title={new Date(Number(t[1]) * 1000).toLocaleString('ru-RU')}>{ago(Number(t[1]) * 1000)}</span>;
    if (/^https?:\/\//.test(part)) return <a key={k} href={part} target="_blank" rel="noreferrer" style={{ color: D.link }} className="break-all hover:underline">{part}</a>;
    return <Fragment key={k}>{part}</Fragment>;
  });
}

/** Block level: code fences, headings, quotes, lists, paragraphs. */
export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
      out.push(<pre key={i} className="my-1 overflow-x-auto rounded-md p-2 text-[13px]" style={{ background: D.code }}>{body.join('\n')}</pre>);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const size = h[1].length === 1 ? 'text-xl' : h[1].length === 2 ? 'text-lg' : 'text-base';
      out.push(<div key={i} className={`${size} mt-1 font-bold`} style={{ color: D.title }}>{inlineMd(h[2])}</div>);
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      out.push(<div key={i} className="my-0.5 pl-3" style={{ borderLeft: `4px solid ${D.quote}` }}>{inlineMd(q[1])}</div>);
      continue;
    }
    const li = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (li) {
      out.push(<div key={i} className="flex gap-2 pl-2"><span aria-hidden>•</span><span className="min-w-0">{inlineMd(li[1])}</span></div>);
      continue;
    }
    out.push(line.trim() === '' ? <div key={i} className="h-2" /> : <div key={i}>{inlineMd(line)}</div>);
  }
  return <div className="wrap-break-word leading-snug">{out}</div>;
}
