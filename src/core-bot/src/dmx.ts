/** Buttons under the private cards: «Это был я» / «Это не я» and «Заглушить это». */
import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, type APIEmbed, type ButtonInteraction } from 'discord.js';
import { backendJson } from './backend.js';
import { DMX_ID, MUTE_HOURS, dmxText, parseDmx } from './dmxLogic.js';
import { log } from './log.js';

/** the link buttons of the card stay, the buttons of the bot go */
function linksOnly(i: ButtonInteraction) {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (const row of i.message.components) {
    const btns = ('components' in row ? row.components : []).filter((c) => c.type === 2 && 'url' in c && c.url).map((c) => ButtonBuilder.from(c as never));
    if (btns.length) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(btns));
  }
  return rows;
}

const note = (e: APIEmbed | undefined, text: string, color: number, title?: string): EmbedBuilder => {
  const b = EmbedBuilder.from(e ?? {}).setColor(color);
  const fields = [...(e?.fields ?? [])].filter((f) => f.name !== '\u200b').slice(0, 24);
  b.setFields(...fields, { name: title ?? '\u200b', value: text.slice(0, 1000) });
  return b;
};

export async function handleDmx(i: ButtonInteraction): Promise<void> {
  const a = DMX_ID.test(i.customId) ? parseDmx(i.customId) : null;
  if (!a) return;
  const ru = !i.locale.startsWith('en');
  const t = dmxText(ru);
  const embed = i.message.embeds[0]?.toJSON();
  try {
    if (a.kind === 'ack') {
      const text = a.me ? t.confirmed : t.notMeBody;
      await i.update({ embeds: [note(embed, text, a.me ? 0x22c55e : 0xef4444, a.me ? undefined : t.notMeTitle)], components: linksOnly(i) });
      return;
    }
    const r = await backendJson<{ ok: boolean; lang?: string }>('/internal/dm/mute', { method: 'POST', body: JSON.stringify({ discordId: i.user.id, serverId: a.serverId, hours: MUTE_HOURS }) });
    if (!r.ok) {
      await i.reply({ content: t.failed }).catch(() => undefined);
      return;
    }
    const tt = dmxText(r.data?.lang !== 'en');
    // the other buttons stay: the person may still open the card
    const keep = linksOnly(i);
    await i.update({ embeds: [note(embed, tt.muted(MUTE_HOURS), 0x64748b)], components: keep });
  } catch (e) {
    log('dmx failed:', (e as Error).message);
  }
}
