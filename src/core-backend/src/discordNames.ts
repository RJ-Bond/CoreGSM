/** Turns a Discord display name into a panel login (3-32 chars: letters, digits, _ . - and single spaces between words). */
export const LOGIN_MIN = 3;
export const LOGIN_MAX = 32;

export function sanitizeLogin(displayName: string, discordId: string): string {
  const tail = (String(discordId).replace(/\D/g, '').slice(-4) || '0000').padStart(4, '0');
  let s = String(displayName ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_.\- ]/gu, '')
    .replace(/ +/g, ' ')
    .trim()
    .slice(0, LOGIN_MAX)
    .trim();
  if (s.length < LOGIN_MIN) s = `${s || 'player'} ${tail}`.trim();
  return s.slice(0, LOGIN_MAX).trim();
}

/** adds a short numeric suffix until `taken` stops matching; the result stays within 32 chars */
export function uniqueLogin(base: string, taken: (candidate: string) => boolean, random: () => number = Math.random): string {
  if (!taken(base)) return base;
  const fit = (suffix: string) => `${base.slice(0, LOGIN_MAX - suffix.length).trim()}${suffix}`;
  for (let i = 2; i < 40; i++) {
    const c = fit(` ${i}`);
    if (!taken(c)) return c;
  }
  for (;;) {
    const c = fit(` ${1000 + Math.floor(random() * 9000)}`);
    if (!taken(c)) return c;
  }
}

/** the in-game nick: control characters out, collapsed to one line, 2..40 chars or null */
export function cleanGameNick(raw: string): string | null {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length >= 2 && s.length <= 40 ? s : null;
}
