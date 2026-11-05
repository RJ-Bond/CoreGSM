/** One look for the bot's cards: a link row to the panel, the status colours and the «now» timestamp. */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type EmbedBuilder } from 'discord.js';
import { getStyle } from './style.js';

/** a row with link buttons to the panel; `path` is added to the address of the panel, `url` is used as it is */
export function panelRow(links: { label: string; path?: string; url?: string | null }[]): ActionRowBuilder<ButtonBuilder>[] {
  const base = getStyle().panelUrl;
  const btns = links
    .map((l) => ({ label: l.label, url: l.url && /^https?:\/\//.test(l.url) ? l.url : base && l.path ? `${base}${l.path}` : '' }))
    .filter((l) => l.url)
    .slice(0, 5)
    .map((l) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(l.label.slice(0, 80)).setURL(l.url));
  return btns.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(btns)] : [];
}

/** the same finishing touch for every card */
export const stamped = (e: EmbedBuilder): EmbedBuilder => e.setTimestamp(new Date());

/** the colour of a card by the share of the servers that are up */
export const healthColor = (up: number, total: number): number => (total === 0 || up === 0 ? 0xe74c3c : up < total ? 0xf5b01e : 0x2ecc71);
