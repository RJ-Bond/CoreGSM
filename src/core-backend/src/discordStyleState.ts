/** The current look of the bot's messages, read from the settings (see discordStyleLogic.ts). */
import { getSetting } from './db.js';
import { type DiscordStyle, resolveStyle } from './discordStyleLogic.js';
import { brand, publicBase } from './site.js';

export const styleSettings = () => ({
  accent: getSetting('discord_accent') ?? '',
  logo: getSetting('discord_logo') !== '0',
  footer: getSetting('discord_footer') ?? '',
});

export function currentStyle(): DiscordStyle {
  const b = brand();
  const s = styleSettings();
  return resolveStyle({ brandName: b.name, brandColor: b.color, accent: s.accent, logo: s.logo, footer: s.footer, baseUrl: publicBase() });
}
