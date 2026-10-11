import { Fragment, useState, type ReactNode } from 'react';
import { api } from '../api';
import { ago, usePoll } from '../ui';

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  author?: { name: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

// Discord's own palette: the preview should look like the real message in either panel theme
const D = { bg: '#2b2d31', outer: '#313338', text: '#dbdee1', title: '#ffffff', muted: '#949ba4', code: '#1e1f22' };

/** The small subset of Discord markdown the embed uses: `code`, **bold** and <t:unix:R> relative times. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|<t:\d+:R>)/g).map((part, i) => {
    if (part.startsWith('`')) {
      return <code key={i} style={{ background: D.code, borderRadius: 4, padding: '1px 5px', fontSize: '0.92em' }}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**')) return <strong key={i} style={{ color: D.title }}>{part.slice(2, -2)}</strong>;
    const t = /^<t:(\d+):R>$/.exec(part);
    if (t) return <span key={i} title={new Date(Number(t[1]) * 1000).toLocaleString('ru-RU')}>{ago(Number(t[1]) * 1000)}</span>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function lines(text: string): ReactNode[] {
  return text.split('\n').map((l, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {inline(l)}
    </Fragment>
  ));
}

export function EmbedView({ embed }: { embed: DiscordEmbed }) {
  const color = `#${(embed.color ?? 0x5a4bd1).toString(16).padStart(6, '0')}`;
  const inlineFields = embed.fields?.filter((f) => f.inline) ?? [];
  const wideFields = embed.fields?.filter((f) => !f.inline) ?? [];
  return (
    <div style={{ background: D.outer, color: D.text }} className="rounded-2xl p-3">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[#5865f2] font-black text-white">C</span>
        <span className="font-bold" style={{ color: D.title }}>CoreGSM</span>
        <span className="rounded px-1 text-[11px] font-bold text-white" style={{ background: '#5865f2' }}>БОТ</span>
      </div>
      <div className="max-w-full rounded-md py-2.5 pl-3.5 pr-3.5" style={{ background: D.bg, borderLeft: `4px solid ${color}` }}>
        {embed.author && <div className="mb-1 text-[13px] font-bold" style={{ color: D.title }}>{embed.author.name}</div>}
        {embed.title && <div className="mb-1 break-words text-base font-bold" style={{ color: D.title }}>{embed.title}</div>}
        {embed.description && <div className="mb-2 break-words text-sm leading-snug">{lines(embed.description)}</div>}
        {inlineFields.length > 0 && (
          <div className="mb-2 grid grid-cols-3 gap-x-3 gap-y-2">
            {inlineFields.map((f) => (
              <div key={f.name} className="min-w-0 text-sm">
                <div className="text-[13px] font-bold" style={{ color: D.title }}>{f.name}</div>
                <div className="break-words leading-snug">{lines(f.value)}</div>
              </div>
            ))}
          </div>
        )}
        {wideFields.map((f) => (
          <div key={f.name} className="mb-2 text-sm">
            <div className="text-[13px] font-bold" style={{ color: D.title }}>{f.name}</div>
            <div className="break-words leading-snug">{lines(f.value)}</div>
          </div>
        ))}
        {embed.footer && (
          <div className="mt-1 text-xs" style={{ color: D.muted }}>
            {embed.footer.text}
            {embed.timestamp ? ` • ${ago(new Date(embed.timestamp).getTime())}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

/** Live preview of exactly what the bot posts (the same builder runs in the backend). */
export default function EmbedPreview({ serverId, intervalSec }: { serverId: number; intervalSec: number }) {
  const [embed, setEmbed] = useState<DiscordEmbed | null>(null);
  usePoll(() => {
    api<DiscordEmbed>(`/servers/${serverId}/embed?interval=${intervalSec}`).then(setEmbed).catch(() => undefined);
  }, 30_000);
  if (!embed) return <div className="skeleton h-48 rounded-2xl bg-soft" />;
  return <EmbedView embed={embed} />;
}
