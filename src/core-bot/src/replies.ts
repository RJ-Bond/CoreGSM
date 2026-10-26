/** Ephemeral replies to the slash commands: plain notices and the player's card. */
import { footerOf, getStyle } from './style.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

export const COLORS = { ok: 0x2ecc71, warn: 0xf5b01e, bad: 0xe74c3c, info: 0x9b1c31 };

export interface ProfileData {
  found: boolean;
  username: string;
  displayName: string;
  gameNick: string;
  rank: { id: string; name: string; hours: number; color: string; image: string; next: { name: string; minHours: number } | null; progress: number } | null;
  achievements: number;
  achievementsTotal?: number;
  nickSeen?: boolean;
  lastSeenAt?: number | null;
  profileUrl: string;
}

/** a status mark in front of a plain reply title, unless the title already starts with an emoji */
export const markOf = (color: number) => (color === COLORS.ok ? '✅' : color === COLORS.bad ? '❌' : color === COLORS.warn ? '⚠️' : 'ℹ️');

export function replyEmbed(title: string, description: string, color: number, url?: string) {
  const lead = /^\p{Extended_Pictographic}/u.test(title) ? '' : `${markOf(color)} `;
  const e = new EmbedBuilder().setTitle(`${lead}${title}`.slice(0, 250)).setDescription(description.slice(0, 3900)).setColor(color === COLORS.info ? getStyle().accent : color).setFooter(footerOf());
  if (url && /^https?:\/\//.test(url)) e.setURL(url);
  return { embeds: [e] };
}

export const hexToInt = (hex: string) => (/^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : COLORS.info);
export const bar10 = (p: number) => {
  const n = Math.max(0, Math.min(10, Math.round(p * 10)));
  return '▰'.repeat(n) + '▱'.repeat(10 - n);
};
export const hoursText = (h: number) => (Number.isInteger(h) ? `${h}` : h.toFixed(1)).replace('.', ',');

/** the panel's address from a profile link: both the old https://host/#/profile and the new https://host/profile */
export const panelBase = (profileUrl: string) => (/^https?:\/\//.test(profileUrl) ? profileUrl.replace(/\/(#\/)?profile\/?$/, '') : '');

/** the player's card: Discord name and picture on top, the rank emblem as the thumbnail, link buttons below */
export function cardReply(
  user: { displayAvatarURL: (o?: { size?: number }) => string },
  displayName: string,
  p: ProfileData,
  opts: { title: string; description?: string; color?: number; onboarding?: boolean },
) {
  const base = panelBase(p.profileUrl);
  const color = opts.color ?? (p.rank ? hexToInt(p.rank.color) : COLORS.info);
  const e = new EmbedBuilder()
    .setColor(color === COLORS.info ? getStyle().accent : color)
    .setAuthor({ name: displayName.slice(0, 120), iconURL: user.displayAvatarURL({ size: 64 }) })
    .setTitle(opts.title.slice(0, 250));
  if (opts.description) e.setDescription(opts.description.slice(0, 3000));
  if (base && p.rank?.image) e.setThumbnail(`${base}${p.rank.image}`);
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  fields.push({ name: '🎮 Игровой ник', value: p.gameNick ? `\`${p.gameNick}\`` : 'не задан', inline: true });
  if (p.rank) {
    fields.push({ name: '🩸 Ранг V Rising', value: `**${p.rank.name}**`, inline: true });
    fields.push({ name: '⏱️ Часов в игре', value: hoursText(p.rank.hours), inline: true });
    if (p.rank.next) {
      const left = Math.max(0, p.rank.next.minHours - p.rank.hours);
      fields.push({ name: `Следующий ранг: ${p.rank.next.name}`, value: `${bar10(p.rank.progress)}  ещё **${hoursText(left)} ч**` });
    } else {
      fields.push({ name: 'Вершина лестницы', value: 'Вы достигли высшего ранга.' });
    }
  } else if (p.gameNick) {
    fields.push({ name: '🩸 Ранг V Rising', value: 'появится после первой игры на сервере', inline: true });
  }
  fields.push({ name: '🏆 Достижений', value: p.achievementsTotal ? `${p.achievements} из ${p.achievementsTotal}` : String(p.achievements), inline: true });
  if (p.gameNick) {
    const seenLine = p.nickSeen
      ? `✅ Ник найден на сервере: последний раз ${p.lastSeenAt ? `<t:${Math.floor(p.lastSeenAt / 1000)}:R>` : 'недавно'}`
      : `⏳ Ждём ваш первый заход под ником \`${p.gameNick}\``;
    if (opts.onboarding) {
      const steps = p.nickSeen
        ? `${seenLine}\nЧасы, ранг и достижения уже считаются. Если ник неверный, исправьте его командой \`/nick\`.`
        : `Зайдите на сервер V Rising под ником \`${p.gameNick}\`. Как только панель увидит игрока, часы, ранг и достижения начнут считаться.\nЕсли ник указан неверно, исправьте его командой \`/nick\`.`;
      fields.push({ name: '👣 Что дальше', value: steps.slice(0, 1000) });
    } else {
      fields.push({ name: '📡 Связь с сервером', value: seenLine });
    }
  }
  e.addFields(fields);
  e.setFooter(footerOf('статистика копится с первого входа на сервер'));

  const components = [];
  if (base) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('👤 Профиль').setURL(`${base}/go/profile`),
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('🏆 Достижения').setURL(`${base}/go/profile/player`),
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('📊 Серверы').setURL(`${base}/go/servers`),
      ),
    );
  }
  return { embeds: [e], components };
}
