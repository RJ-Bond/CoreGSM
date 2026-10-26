/** The look of the bot's own replies (footer, accent colour, logo): set in the panel and refreshed with the config. */
export interface BotStyle { footer: string; accent: number; logoUrl: string | null }

let current: BotStyle = { footer: 'CoreGSM', accent: 0x9b1c31, logoUrl: null };

export const getStyle = (): BotStyle => current;

export function setStyle(s: unknown): void {
  const o = s as Partial<BotStyle> | null;
  if (!o || typeof o.footer !== 'string' || typeof o.accent !== 'number') return;
  current = { footer: o.footer.slice(0, 40) || 'CoreGSM', accent: o.accent, logoUrl: typeof o.logoUrl === 'string' && /^https?:\/\//.test(o.logoUrl) ? o.logoUrl : null };
}

/** footer for an embed: «<signature> · <what>» or just the signature, with the logo when there is one */
export function footerOf(what?: string): { text: string; iconURL?: string } {
  const s = current;
  return { text: what ? `${what} · ${s.footer}` : s.footer, ...(s.logoUrl ? { iconURL: s.logoUrl } : {}) };
}
