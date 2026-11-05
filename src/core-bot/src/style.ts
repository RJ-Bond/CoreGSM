/** The look of the bot's own replies (footer, accent colour, logo): set in the panel and refreshed with the config. */
export interface BotStyle { footer: string; accent: number; logoUrl: string | null; version: string; panelUrl: string | null; supportUrl: string | null }

let current: BotStyle = { footer: 'CoreGSM', accent: 0x9b1c31, logoUrl: null, version: '', panelUrl: null, supportUrl: null };

export const getStyle = (): BotStyle => current;

export function setStyle(s: unknown): void {
  const o = s as Partial<BotStyle> | null;
  if (!o || typeof o.footer !== 'string' || typeof o.accent !== 'number') return;
  current = {
    footer: o.footer.slice(0, 40) || 'CoreGSM',
    accent: o.accent,
    logoUrl: typeof o.logoUrl === 'string' && /^https?:\/\//.test(o.logoUrl) ? o.logoUrl : null,
    version: typeof o.version === 'string' && /^[\w.+-]{1,20}$/.test(o.version) ? o.version : '',
    supportUrl: typeof o.supportUrl === 'string' && /^https:\/\/[^\s]{4,300}$/.test(o.supportUrl) ? o.supportUrl : null,
    panelUrl: typeof o.panelUrl === 'string' && /^https?:\/\/[^\s]+$/.test(o.panelUrl) ? o.panelUrl.replace(/\/+$/, '') : null,
  };
}

/** footer for an embed: «<what> · <signature> · v<version>» with the logo when there is one */
export function footerOf(what?: string): { text: string; iconURL?: string } {
  const s = current;
  const text = [what, s.footer, s.version ? `v${s.version}` : ''].filter(Boolean).join(' · ');
  return { text: text.slice(0, 2000), ...(s.logoUrl ? { iconURL: s.logoUrl } : {}) };
}
