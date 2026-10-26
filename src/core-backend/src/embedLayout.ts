/** How much a status embed shows: «detailed» is the full card, «compact» keeps the essentials, «minimal» is one line. */
import type { DiscordEmbed } from './embed.js';

export type EmbedLayout = 'detailed' | 'compact' | 'minimal';
export const LAYOUTS: readonly EmbedLayout[] = ['detailed', 'compact', 'minimal'];
export const parseLayout = (v: unknown): EmbedLayout => (LAYOUTS as readonly string[]).includes(String(v)) ? (String(v) as EmbedLayout) : 'detailed';

type Field = NonNullable<DiscordEmbed['fields']>[number];
const starts = (f: Field, ...marks: string[]) => marks.some((m) => f.name.startsWith(m));

/** the first line of the «Игроки» value (the counter without the fill bar) */
const firstLine = (s: string) => s.split('\n')[0] ?? s;

export function applyLayout(e: DiscordEmbed, layout: EmbedLayout): DiscordEmbed {
  if (layout === 'detailed') return e;
  const fields = e.fields ?? [];
  const status = fields.find((f) => starts(f, '📶'));
  const players = fields.find((f) => starts(f, '👥'));
  const who = fields.find((f) => starts(f, '🧑‍🤝‍🧑'));
  const last = fields.find((f) => starts(f, '⏱️ Последний'));
  const map = fields.find((f) => starts(f, '🗺️'));
  if (layout === 'compact') {
    const keep = [status, players, who, last].filter((f): f is Field => !!f);
    const { author: _a, image: _i, ...rest } = e;
    return { ...rest, fields: keep.length ? keep : e.fields };
  }
  // minimal: «🟢 Онлайн · 12 мс · 3/20 · de_dust2», the title, the colour and the time of the update
  const parts = [status && status.value, players && players.value !== '—' ? `👥 ${firstLine(players.value)}` : null, map && map.value !== '—' ? `🗺️ ${map.value}` : null].filter(Boolean) as string[];
  const description = [parts.join(' · '), e.description].filter(Boolean).join('\n');
  const { author: _a, image: _i, thumbnail: _t, fields: _f, ...rest } = e;
  return { ...rest, description: description || e.description };
}
