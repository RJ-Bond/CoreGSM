/**
 * Protection against SSRF for requests the panel makes to an address typed by an administrator (outgoing webhooks):
 *  - only http and https, no credentials in the address, a sane length;
 *  - loopback, private, link-local, carrier-grade NAT, multicast and reserved addresses are refused, for IPv4, IPv6 and
 *    IPv4-mapped IPv6 alike; a host name is checked after it is resolved, and the connection is made to the checked
 *    address (see safeLookup), so a name that changes its answer between the check and the connection gets nothing;
 *  - `allowPrivate` is an explicit decision of the owner for one channel (a webhook inside the own network).
 * Pure functions are tested directly (test/url-guard.test.ts).
 */
import dns from 'node:dns';
import net from 'node:net';

/** true for an address that must not be reached from the panel unless the owner allowed it */
export function isBlockedAddress(ip: string): boolean {
  let a = ip.trim().toLowerCase();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  const v = net.isIP(a);
  if (v === 4) return blockedV4(a);
  if (v === 6) return blockedV6(a);
  return true; // not an address at all
}

function blockedV4(a: string): boolean {
  const [p, q] = a.split('.').map(Number);
  if (p === 0 || p === 10 || p === 127) return true;
  if (p === 100 && q >= 64 && q <= 127) return true; // carrier-grade NAT
  if (p === 169 && q === 254) return true; // link-local, cloud metadata
  if (p === 172 && q >= 16 && q <= 31) return true;
  if (p === 192 && q === 168) return true;
  if (p === 192 && q === 0) return true; // IETF protocol assignments, documentation
  if (p === 198 && (q === 18 || q === 19)) return true; // benchmarking
  if (p >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** the 16 bytes of an IPv6 address, or null */
function bytesV6(a: string): number[] | null {
  let s = a;
  // an embedded IPv4 tail (::ffff:1.2.3.4) becomes two groups
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const o = tail[1]!.split('.').map(Number);
    if (o.some((x) => x > 255)) return null;
    s = s.slice(0, s.length - tail[1]!.length) + ((o[0]! << 8) | o[1]!).toString(16) + ':' + ((o[2]! << 8) | o[3]!).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...rest];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    const n = parseInt(g, 16);
    if (!/^[0-9a-f]{1,4}$/.test(g) || Number.isNaN(n)) return null;
    out.push(n >> 8, n & 255);
  }
  return out;
}

function blockedV6(a: string): boolean {
  const b = bytesV6(a);
  if (!b) return true;
  const zeros = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  if (zeros(0, 15) && (b[15] === 0 || b[15] === 1)) return true; // :: and ::1
  // IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible (::a.b.c.d): judged by the IPv4 address inside
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return blockedV4(b.slice(12).join('.'));
  if (zeros(0, 12)) return blockedV4(b.slice(12).join('.'));
  // NAT64 64:ff9b::/96 carries an IPv4 address too
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12)) return blockedV4(b.slice(12).join('.'));
  if ((b[0]! & 0xfe) === 0xfc) return true; // unique local fc00::/7
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true; // link-local fe80::/10
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) return true; // site-local fec0::/10
  if (b[0] === 0xff) return true; // multicast
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // documentation
  return false;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/** Syntax and scheme of a webhook address. Names are checked later, after resolving (safeLookup). */
export function checkWebhookUrl(raw: string, allowPrivate = false): UrlCheck {
  const text = raw.trim();
  if (!text || text.length > 500) return { ok: false, error: 'Укажите адрес вебхука (не длиннее 500 символов)' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: 'Адрес вебхука указан неверно: нужен вид https://example.com/hook' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: 'Разрешены только адреса http:// и https://' };
  if (url.username || url.password) return { ok: false, error: 'Логин и пароль в адресе не поддерживаются: используйте секрет подписи' };
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return { ok: false, error: 'В адресе нет имени сервера' };
  if (!allowPrivate) {
    if (net.isIP(host)) {
      if (isBlockedAddress(host)) return { ok: false, error: 'Адрес из локальной сети или служебный: он запрещён. Разрешить такие адреса можно отдельной настройкой канала' };
    } else if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
      return { ok: false, error: 'Локальные имена запрещены. Разрешить такие адреса можно отдельной настройкой канала' };
    }
  }
  return { ok: true, url };
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

/**
 * A `lookup` for node:http / node:https: resolves the name and refuses the connection when any of the answers is a
 * forbidden address (unless allowPrivate). The socket then connects to the very address that was checked.
 */
export function safeLookup(allowPrivate: boolean) {
  return (hostname: string, options: dns.LookupOptions, cb: LookupCb): void => {
    dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
      if (err) return cb(err, '', 4);
      const list = (addrs as dns.LookupAddress[]) ?? [];
      if (!list.length) return cb(Object.assign(new Error('имя не найдено'), { code: 'ENOTFOUND' }), '', 4);
      if (!allowPrivate && list.some((a) => isBlockedAddress(a.address))) {
        return cb(Object.assign(new Error('адрес запрещён: он указывает на локальную сеть'), { code: 'EBLOCKED' }), '', 4);
      }
      if (options.all) return cb(null, list.map((a) => ({ address: a.address, family: a.family })));
      cb(null, list[0]!.address, list[0]!.family);
    });
  };
}
