/** One look for everything the bot posts: accent colour, brand line, logo. Pure, covered by tests. */
export interface DiscordStyle {
  brand: string;
  /** colour of neutral messages (tests, polls, weekly digest); warnings and errors keep their own */
  accent: number;
  logoUrl: string | null;
  /** the text of the footer before « · what it is » */
  footer: string;
}

/** the grey-blue the messages used before the style was configurable: replaced by the accent */
export const LEGACY_NEUTRAL = [0x5865f2, 0x5a4bd1];

const hexToInt = (h: string): number | null => (/^#[0-9a-fA-F]{6}$/.test(h) ? parseInt(h.slice(1), 16) : null);

export function resolveStyle(i: { brandName: string; brandColor: string; accent: string; logo: boolean; footer: string; baseUrl: string | null }): DiscordStyle {
  return {
    brand: i.brandName,
    accent: hexToInt(i.accent.trim()) ?? hexToInt(i.brandColor) ?? 0x5865f2,
    logoUrl: i.logo && i.baseUrl ? `${i.baseUrl}/logo-128.png` : null,
    footer: i.footer.trim().slice(0, 40) || i.brandName,
  };
}

const LABEL: Record<string, string> = { digest: 'итоги недели', poll: 'голосование' };
export const footerLabel = (kind: string): string => LABEL[kind] ?? 'оповещение';

type Embed = Record<string, unknown> & { color?: number; footer?: { text?: string; icon_url?: string } };

/**
 * The embed of an alert in the common style: the footer «<brand> · <what>» with the logo, the accent instead of the old
 * neutral colour. A footer written for the message itself (the update notice says when the version was released) stays.
 */
export function styleAlertEmbed(e: Embed, kind: string, s: DiscordStyle): Embed {
  const own = e.footer?.text && !/^CoreGSM\b/.test(e.footer.text);
  const footer = own ? e.footer : { text: `${s.footer} · ${footerLabel(kind)}`, ...(s.logoUrl ? { icon_url: s.logoUrl } : {}) };
  const color = typeof e.color === 'number' && LEGACY_NEUTRAL.includes(e.color) ? s.accent : e.color;
  return { ...e, footer, ...(color !== undefined ? { color } : {}) };
}
