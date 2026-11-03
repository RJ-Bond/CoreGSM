/** What an administrator types into the bot settings: the proxy address (normalised to a URL) and the bot token. */

export const PROXY_RE = /^(socks5h?|http|https):\/\/([^@/\s]+@)?[^@/:\s]+:\d{1,5}\/?$/;
export const maskProxy = (u: string) => u.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@');

export type ProxyType = 'socks5' | 'http';

/**
 * Accepts what proxy sellers usually hand out and turns it into a URL:
 *   socks5://user:pass@host:port   (kept as is)
 *   host:port:user:pass            (the password may contain ":")
 *   user:pass@host:port
 *   host:port
 * The scheme comes from `type` when the text has none. Credentials are percent-encoded.
 */
export function normalizeProxy(raw: string, type: ProxyType): string {
  const v = raw.trim();
  if (!v || /^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
  let host = '';
  let port = '';
  let user: string | undefined;
  let pass: string | undefined;
  const at = v.lastIndexOf('@');
  // "host:port:user:pass" is recognised first: the password itself may contain "@" or ":"
  if (/^[^@:\s]+:\d{1,5}:[^\s]+$/.test(v)) {
    const p = v.split(':');
    [host, port, user] = p;
    pass = p.slice(3).join(':');
  } else if (at > 0) {
    const cred = v.slice(0, at);
    const ci = cred.indexOf(':');
    user = ci < 0 ? cred : cred.slice(0, ci);
    pass = ci < 0 ? undefined : cred.slice(ci + 1);
    [host, port] = v.slice(at + 1).split(':');
  } else {
    const p = v.split(':');
    if (p.length === 2) [host, port] = p;
    else if (p.length >= 4) {
      [host, port, user] = p;
      pass = p.slice(3).join(':');
    } else return v;
  }
  const auth = user ? `${encodeURIComponent(user)}${pass !== undefined ? ':' + encodeURIComponent(pass) : ''}@` : '';
  return `${type}://${auth}${host}:${port}`;
}

export const PROXY_HELP = 'Прокси: host:port:логин:пароль, socks5://логин:пароль@host:port или http://host:port';

/** a Discord bot token: three base64url parts joined by dots (the same check as the form in the panel) */
export const BOT_TOKEN_RE = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/;
// a browser that autofills the panel's own password into the token field must not overwrite a working token
export const TOKEN_HELP = 'Это не похоже на токен бота: он состоит из трёх частей через точки. Скопируйте его целиком в Discord Developer Portal (Bot → Reset Token).';
