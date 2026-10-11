import { useState } from 'react';
import { api } from '../api';
import { Markdown } from '../components/Markdown';
import { ago, usePoll } from '../ui';

export interface DiscordEmbed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  author?: { name: string; icon_url?: string };
  thumbnail?: { url: string };
  image?: { url: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

// Discord's own palette: the preview should look like the real message in either panel theme
const D = { bg: '#2b2d31', outer: '#313338', text: '#dbdee1', title: '#ffffff', muted: '#949ba4' };

/** A Discord message as the bot would post it: optional text above and an embed below. */
export function EmbedView({ embed, content }: { embed?: DiscordEmbed | null; content?: string }) {
  const color = `#${(embed?.color ?? 0x5865f2).toString(16).padStart(6, '0')}`;
  const inlineFields = embed?.fields?.filter((f) => f.inline) ?? [];
  const wideFields = embed?.fields?.filter((f) => !f.inline) ?? [];
  return (
    <div style={{ background: D.outer, color: D.text }} className="rounded-2xl p-3">
      <div className="mb-1.5 flex items-center gap-2 text-sm">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[#5865f2] font-black text-white">C</span>
        <span className="font-bold" style={{ color: D.title }}>CoreGSM</span>
        <span className="rounded px-1 text-[11px] font-bold text-white" style={{ background: '#5865f2' }}>БОТ</span>
      </div>
      {content && <div className="mb-2 text-sm"><Markdown text={content} /></div>}
      {embed && (
        <div className="max-w-full rounded-md py-2.5 pl-3.5 pr-3.5" style={{ background: D.bg, borderLeft: `4px solid ${color}` }}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {embed.author && (
                <div className="mb-1 flex items-center gap-2 text-[13px] font-bold" style={{ color: D.title }}>
                  {embed.author.icon_url && <img src={embed.author.icon_url} alt="" className="h-6 w-6 rounded-full object-cover" />}
                  {embed.author.name}
                </div>
              )}
              {embed.title && (
                <div className="mb-1 break-words text-base font-bold" style={{ color: embed.url ? '#00a8fc' : D.title }}>
                  {embed.url ? <a href={embed.url} target="_blank" rel="noreferrer" className="hover:underline">{embed.title}</a> : embed.title}
                </div>
              )}
              {embed.description && <div className="mb-2 text-sm"><Markdown text={embed.description} /></div>}
            </div>
            {embed.thumbnail && <img src={embed.thumbnail.url} alt="" className="h-20 w-20 shrink-0 rounded-md object-cover" />}
          </div>
          {inlineFields.length > 0 && (
            <div className="mb-2 grid grid-cols-3 gap-x-3 gap-y-2">
              {inlineFields.map((f, i) => (
                <div key={`${f.name}-${i}`} className="min-w-0 text-sm">
                  <div className="text-[13px] font-bold" style={{ color: D.title }}>{f.name}</div>
                  <Markdown text={f.value} />
                </div>
              ))}
            </div>
          )}
          {wideFields.map((f, i) => (
            <div key={`${f.name}-${i}`} className="mb-2 text-sm">
              <div className="text-[13px] font-bold" style={{ color: D.title }}>{f.name}</div>
              <Markdown text={f.value} />
            </div>
          ))}
          {embed.image && <img src={embed.image.url} alt="" className="mt-1 max-h-72 w-full rounded-md object-cover" />}
          {(embed.footer || embed.timestamp) && (
            <div className="mt-2 text-xs" style={{ color: D.muted }}>
              {embed.footer?.text}
              {embed.footer && embed.timestamp ? ' • ' : ''}
              {embed.timestamp ? ago(new Date(embed.timestamp).getTime()) : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Live preview of exactly what the bot posts for a server (the same builder runs in the backend). */
export default function EmbedPreview({ serverId, intervalSec }: { serverId: number; intervalSec: number }) {
  const [embed, setEmbed] = useState<DiscordEmbed | null>(null);
  usePoll(() => {
    api<DiscordEmbed>(`/servers/${serverId}/embed?interval=${intervalSec}`).then(setEmbed).catch(() => undefined);
  }, 30_000);
  if (!embed) return <div className="skeleton h-48 rounded-2xl bg-soft" />;
  return <EmbedView embed={embed} />;
}
