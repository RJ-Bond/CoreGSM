import { useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { api } from '../api';
import { DiscordMd, EnvCtx, THEMES, ThemeCtx, type DTheme, type MdEnv } from '../components/news/DiscordMd';
import { usePoll } from '../ui';

export interface DiscordEmbed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  author?: { name: string; icon_url?: string };
  thumbnail?: { url: string };
  image?: { url: string };
  /** `idx` is the position in the editor's list (to find the form control on click) */
  fields?: { name: string; value: string; inline?: boolean; idx?: number }[];
  footer?: { text: string; icon_url?: string };
  timestamp?: string;
}

/** a clickable part of the preview */
export interface PreviewPart {
  embed: number;
  part: 'content' | 'title' | 'description' | 'author' | 'thumbnail' | 'image' | 'footer' | 'field';
  field?: number;
}

/** only http(s) links and images are rendered: `javascript:` and `data:` urls are dropped */
const safeUrl = (u?: string | null): string | undefined => (u && /^https?:\/\//i.test(u.trim()) ? u.trim() : undefined);

const PART_LABEL: Record<PreviewPart['part'], string> = {
  content: 'текст сообщения', title: 'заголовок', description: 'основной текст', author: 'автора', thumbnail: 'миниатюру', image: 'картинку', footer: 'подпись', field: 'поле',
};

function Part({ part, embed, field, onPick, bad, className, style, children }: {
  part: PreviewPart['part']; embed: number; field?: number; onPick?: (p: PreviewPart) => void; bad?: boolean; className?: string; style?: CSSProperties; children: ReactNode;
}) {
  const cls = `${className ?? ''} ${bad ? 'pv-bad' : ''} ${onPick ? 'pv-part' : ''}`.trim();
  if (!onPick) return <div className={cls} style={style} title={bad ? 'Превышен лимит Discord' : undefined}>{children}</div>;
  const pick = () => onPick({ embed, part, field });
  return (
    <div
      className={cls}
      style={style}
      role="button"
      tabIndex={0}
      title={bad ? `Превышен лимит Discord. Перейти к полю: ${PART_LABEL[part]}` : `Перейти к полю: ${PART_LABEL[part]}`}
      aria-label={`Перейти к полю: ${PART_LABEL[part]}`}
      onClick={(e: MouseEvent) => { if ((e.target as HTMLElement).closest('a,[data-spoiler]')) return; pick(); }}
      onKeyDown={(e: KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(); } }}
    >
      {children}
    </div>
  );
}

/** Discord groups neighbouring inline fields in rows of up to three */
function fieldRows(fields: NonNullable<DiscordEmbed['fields']>) {
  const rows: NonNullable<DiscordEmbed['fields']>[] = [];
  let cur: NonNullable<DiscordEmbed['fields']> = [];
  for (const f of fields) {
    if (f.inline) {
      cur.push(f);
      if (cur.length === 3) { rows.push(cur); cur = []; }
    } else {
      if (cur.length) { rows.push(cur); cur = []; }
      rows.push([f]);
    }
  }
  if (cur.length) rows.push(cur);
  return rows;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const t = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const now = new Date();
  return d.toDateString() === now.toDateString() ? `Сегодня, в ${t}` : `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${t}`;
}

function EmbedCard({ e, index, theme, onPick, invalid, fill }: { e: DiscordEmbed; index: number; theme: DTheme; onPick?: (p: PreviewPart) => void; invalid?: Set<string>; fill?: boolean }) {
  const authorIcon = safeUrl(e.author?.icon_url);
  const embedUrl = safeUrl(e.url);
  const thumb = safeUrl(e.thumbnail?.url);
  const image = safeUrl(e.image?.url);
  const footerIcon = safeUrl(e.footer?.icon_url);
  const color = `#${(e.color ?? 0x5865f2).toString(16).padStart(6, '0')}`;
  const rows = fieldRows(e.fields ?? []);
  const ts = e.timestamp ? stamp(e.timestamp) : '';
  const bad = (k: string) => !!invalid?.has(`${index}:${k}`);
  return (
    <div
      className="mt-1 rounded-md py-2 pl-3 pr-4"
      style={{ background: theme.embed, borderLeft: `4px solid ${color}`, border: `1px solid ${theme.embedBorder}`, borderLeftWidth: 4, borderLeftColor: color, maxWidth: fill ? '100%' : 'min(520px, 100%)', width: 'fit-content', minWidth: 'min(100%, 280px)' }}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {e.author && (
            <Part part="author" embed={index} onPick={onPick} bad={bad('author')} className="mb-1 flex items-center gap-2 text-fs-sm font-bold">
              <span className="flex items-center gap-2" style={{ color: theme.title }}>
                {authorIcon && <img src={authorIcon} alt="" className="h-6 w-6 rounded-full object-cover" />}
                {e.author.name}
              </span>
            </Part>
          )}
          {e.title && (
            <Part part="title" embed={index} onPick={onPick} bad={bad('title')} className="mb-1 wrap-break-word text-base font-bold">
              {embedUrl ? <a href={embedUrl} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: theme.link }}>{e.title}</a> : <span style={{ color: theme.title }}>{e.title}</span>}
            </Part>
          )}
          {e.description && (
            <Part part="description" embed={index} onPick={onPick} bad={bad('description')} className="mb-2 text-sm">
              <DiscordMd text={e.description.replace(/⠀{8,}/g, '').replace(/\n+$/, '')} />
            </Part>
          )}
        </div>
        {thumb && (
          <Part part="thumbnail" embed={index} onPick={onPick} className="shrink-0">
            <img src={thumb} alt="" className="h-20 w-20 rounded-md object-cover" />
          </Part>
        )}
      </div>
      {rows.map((row, ri) => (
        <div key={ri} className="mb-2 grid gap-x-3 gap-y-2" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
          {row.map((f, i) => (
            <Part key={`${f.idx ?? ri}-${i}`} part="field" embed={index} field={f.idx} onPick={onPick} bad={f.idx != null && bad(`field:${f.idx}`)} className="min-w-0 text-sm">
              <div className="text-fs-sm font-bold" style={{ color: theme.title }}>{f.name}</div>
              <DiscordMd text={f.value} />
            </Part>
          ))}
        </div>
      ))}
      {image && (
        <Part part="image" embed={index} onPick={onPick} className="mt-1">
          <img src={image} alt="" className="max-h-[300px] w-full rounded-md object-cover" />
        </Part>
      )}
      {(e.footer || ts) && (
        <Part part="footer" embed={index} onPick={onPick} bad={bad('footer')} className="mt-2 text-xs">
          <span className="flex items-center gap-1.5" style={{ color: theme.muted }}>
            {footerIcon && <img src={footerIcon} alt="" className="h-5 w-5 rounded-full" />}
            <span>
              {e.footer?.text}
              {e.footer?.text && ts ? ' • ' : ''}
              {ts}
            </span>
          </span>
        </Part>
      )}
    </div>
  );
}

/**
 * A Discord message as the bot would post it: optional text above and up to ten embeds below.
 * `theme` / `width` switch the Discord skin and the phone layout; `onPick` makes the parts clickable;
 * `invalid` holds keys of parts that exceed Discord limits (`<embed>:title`, `<embed>:field:<i>`, `content`).
 */
export function EmbedView({
  embed, embeds, content, theme = 'dark', width = 'desktop', onPick, invalid, env, botName = 'CoreGSM', children,
}: {
  embed?: DiscordEmbed | null;
  embeds?: DiscordEmbed[];
  content?: string;
  theme?: 'dark' | 'light';
  width?: 'desktop' | 'phone';
  onPick?: (p: PreviewPart) => void;
  invalid?: Set<string>;
  env?: MdEnv;
  botName?: string;
  children?: ReactNode;
}) {
  const t = THEMES[theme];
  const list = embeds ?? (embed ? [embed] : []);
  const phone = width === 'phone';
  const now = new Date();
  return (
    <ThemeCtx.Provider value={t}>
      <EnvCtx.Provider value={env ?? {}}>
        <div className={phone ? 'mx-auto w-full max-w-[380px]' : 'w-full'}>
          <div
            style={{ background: t.outer, color: t.text, ...(phone ? { border: '6px solid #1e1f22', borderRadius: 28 } : {}) }}
            className={`${phone ? '' : 'rounded-2xl'} p-3 ${phone ? 'text-fs-md' : 'text-fs-base'}`}
          >
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full font-black text-white" style={{ background: '#5865f2' }} aria-hidden>{botName.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 text-fs-base leading-tight">
                  <span className="font-bold" style={{ color: t.title }}>{botName}</span>
                  <span className="rounded-sm px-1 text-xs font-bold uppercase text-white" style={{ background: '#5865f2' }}>БОТ</span>
                  <span className="text-xs" style={{ color: t.muted }}>Сегодня, в {pad2(now.getHours())}:{pad2(now.getMinutes())}</span>
                </div>
                {content && (
                  <Part part="content" embed={0} onPick={onPick} bad={invalid?.has('content')} className="mt-0.5">
                    <DiscordMd text={content} />
                  </Part>
                )}
                {list.map((e, i) => <EmbedCard key={i} e={e} index={i} theme={t} onPick={onPick} invalid={invalid} fill={phone} />)}
                {children}
              </div>
            </div>
          </div>
        </div>
      </EnvCtx.Provider>
    </ThemeCtx.Provider>
  );
}

/** Live preview of exactly what the bot posts for a server (the same builder runs in the backend). */
export default function EmbedPreview({ serverId, intervalSec, layout = 'detailed' }: { serverId: number; intervalSec: number; layout?: string }) {
  const [embed, setEmbed] = useState<DiscordEmbed | null>(null);
  usePoll(() => {
    api<DiscordEmbed>(`/servers/${serverId}/embed?interval=${intervalSec}&layout=${layout}`).then(setEmbed).catch(() => undefined);
  }, 30_000);
  if (!embed) return <div className="skeleton h-48 rounded-2xl bg-soft" />;
  return <EmbedView embed={embed} />;
}
