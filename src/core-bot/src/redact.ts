/**
 * Takes secrets out of text that is about to be written to a log: the bot token, webhook addresses, session tokens,
 * API keys, passwords in addresses and in «password=…» pairs, encrypted values of the settings. An error message from a
 * library can carry any of them (a failed request prints its URL and headers), so everything the logger writes goes
 * through here. The mark that replaces a secret is «***».
 */

const MASK = '***';

const RULES: [RegExp, string][] = [
  // a Discord bot token: id.timestamp.hmac
  [/\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/g, `${MASK}`],
  // a Discord webhook: the part after the id is the secret
  [/(discord(?:app)?\.com\/api\/webhooks\/\d+\/)[A-Za-z0-9_-]+/gi, `$1${MASK}`],
  // a JSON Web Token (the session)
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, `${MASK}`],
  // an Authorization header
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MASK}`],
  // a key of the public API of the panel
  [/\bcgsm_[A-Za-z0-9_-]{16,}/g, `cgsm_${MASK}`],
  // an encrypted value of the settings
  [/\benc:v1:[A-Za-z0-9+/=_-]{8,}/g, `enc:v1:${MASK}`],
  // credentials inside an address: scheme://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${MASK}:${MASK}@`],
  // «password=…», «"token": "…"», «secret: …» in a query string, JSON or a line of text
  [/(["']?\b(?:password|passwd|pass|secret|token|api[_-]?key|apikey|cookie|passphrase)["']?\s*[:=]\s*["']?)[^\s"',;&}]{3,}/gi, `$1${MASK}`],
  // a long hexadecimal string: a hash, a signing key, an internal token
  [/\b[a-f0-9]{40,}\b/gi, `${MASK}`],
];

/** the text without secrets; anything that is not a string is returned as it is */
export function redact<T>(value: T): T {
  if (typeof value !== 'string' || value.length === 0) return value;
  let out: string = value;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out as T;
}
