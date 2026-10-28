import { useMemo, useState } from 'react';
import type { Server } from '../../api';
import { gameColor } from '../../games';
import { EmbedView, type DiscordEmbed, type PreviewPart } from '../../pages/EmbedPreview';
import { t, useI18n } from '../../i18n';
import { imageSrc, invalidParts, parseHex, resolveVars, type Draft, type EmbedDraft, type VarSample } from './model';

const load = <T extends string>(key: string, allowed: T[], def: T): T => {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : def;
  } catch { return def; }
};
const save = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* ignore */ } };

export function embedView(e: EmbedDraft, v: VarSample): DiscordEmbed | null {
  const r = (s: string) => resolveVars(s, v);
  const fields = e.fields
    .map((f, idx) => ({ name: r(f.name), value: r(f.value), inline: f.inline, idx }))
    .filter((f) => f.name.trim() && f.value.trim());
  const img = imageSrc(e);
  const has = e.title || e.description || e.authorName || e.thumbnail || img || fields.length || e.footer;
  if (!has) return null;
  return {
    title: e.title ? r(e.title) : undefined,
    url: e.url || undefined,
    description: e.description ? r(e.description) : undefined,
    color: e.color,
    author: e.authorName ? { name: r(e.authorName), icon_url: e.authorIcon || undefined } : undefined,
    thumbnail: e.thumbnail ? { url: e.thumbnail } : undefined,
    image: img ? { url: img } : undefined,
    fields,
    footer: e.footer ? { text: r(e.footer) } : undefined,
    timestamp: e.timestamp ? new Date().toISOString() : undefined,
  };
}

export const messageContent = (d: Draft, v: VarSample) => {
  const mention = d.mention === 'everyone' ? '@everyone' : d.mention === 'here' ? '@here' : '';
  return [mention, resolveVars(d.content.trim(), v)].filter(Boolean).join('\n');
};

/** placeholder of the live status block: the real card is built by the bot when the message goes out */
function statusEmbeds(ids: number[], servers: Server[] | null): DiscordEmbed[] {
  return ids.map((id) => {
    const s = servers?.find((x) => x.id === id);
    const color = s ? parseHex(gameColor(s.game)) : 0x5865f2;
    return {
      title: s ? s.name : t('d2.mt.serverNo', { id }),
      description: s ? (s.online ? `🟢 ${t('d2.srv.f.online')} · ${t('d2.pv.cnt', { a: s.players, b: s.maxPlayers })}${s.map ? ` · ${s.map}` : ''}` : `🔴 ${t('d2.bl.offline')}`) : t('d2.pv.dataLater'),
      color: Number.isFinite(color) ? color : 0x5865f2,
      footer: { text: t('d2.pv.footer') },
    };
  });
}

export function Preview({
  draft, vars, servers, channelNames, onPick, total,
}: {
  draft: Draft;
  vars: VarSample;
  servers: Server[] | null;
  channelNames: Record<string, string>;
  onPick: (p: PreviewPart) => void;
  total: number;
}) {
  useI18n();
  const [theme, setTheme] = useState<'dark' | 'light'>(() => load('news_pv_theme', ['dark', 'light'], 'dark'));
  const [width, setWidth] = useState<'desktop' | 'phone'>(() => load('news_pv_width', ['desktop', 'phone'], 'desktop'));
  const content = messageContent(draft, vars);
  const embeds = useMemo(() => draft.embeds.map((e) => embedView(e, vars)), [draft.embeds, vars]);
  // a tab without content still keeps its index for click mapping: render only those that have something
  const shown: { e: DiscordEmbed; i: number }[] = [];
  embeds.forEach((e, i) => { if (e) shown.push({ e, i }); });
  const status = statusEmbeds(draft.statusServerIds, servers);
  const invalid = useMemo(() => invalidParts(draft), [draft]);
  const empty = !content && shown.length === 0 && status.length === 0;

  // remap the indexes to what is drawn (empty embeds are skipped)
  const list = [...shown.map((s) => s.e), ...status];
  const realIndex = shown.map((s) => s.i);
  const inv = new Set<string>();
  invalid.forEach((k) => {
    if (k === 'content') { inv.add(k); return; }
    const [n, ...rest] = k.split(':');
    const pos = realIndex.indexOf(Number(n));
    if (pos >= 0) inv.add(`${pos}:${rest.join(':')}`);
  });
  const pick = (p: PreviewPart) => onPick(p.part === 'content' ? p : p.embed < realIndex.length ? { ...p, embed: realIndex[p.embed] } : p);

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black">{t('d2.pv.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg" role="group" aria-label={t('d2.pv.theme')}>
            <button type="button" className="seg-item" aria-pressed={theme === 'dark'} onClick={() => { setTheme('dark'); save('news_pv_theme', 'dark'); }}>{t('cards.dark')}</button>
            <button type="button" className="seg-item" aria-pressed={theme === 'light'} onClick={() => { setTheme('light'); save('news_pv_theme', 'light'); }}>{t('d2.brand.light')}</button>
          </div>
          <div className="seg" role="group" aria-label={t('d2.pv.width')}>
            <button type="button" className="seg-item" aria-pressed={width === 'desktop'} onClick={() => { setWidth('desktop'); save('news_pv_width', 'desktop'); }}>{t('d2.pv.desktop')}</button>
            <button type="button" className="seg-item" aria-pressed={width === 'phone'} onClick={() => { setWidth('phone'); save('news_pv_width', 'phone'); }}>{t('d2.pv.phone')}</button>
          </div>
        </div>
      </div>
      {empty ? (
        <p className="py-10 text-center font-semibold text-mute">{t('d2.pv.empty')}</p>
      ) : (
        <EmbedView
          content={content}
          embeds={list}
          theme={theme}
          width={width}
          onPick={pick}
          invalid={inv}
          env={{ channelName: (id) => channelNames[id] }}
        />
      )}
      <p className="mt-2 flex items-center justify-between gap-2 text-xs font-semibold text-mute">
        <span>{t('d2.pv.hint')}</span>
        <span className={`shrink-0 font-extrabold tabular-nums ${total > 6000 ? 'text-bad' : ''}`}>{total}/6000</span>
      </p>
    </div>
  );
}
