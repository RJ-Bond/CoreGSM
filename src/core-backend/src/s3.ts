/** AWS Signature V4 for an S3-compatible PUT (AWS, Backblaze B2, Cloudflare R2, Wasabi, MinIO, Yandex Object Storage…). No SDK: just node:crypto. */
import crypto from 'node:crypto';

const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac('sha256', key).update(data).digest();
const sha256 = (data: string) => crypto.createHash('sha256').update(data).digest('hex');
/** RFC 3986 encoding as SigV4 wants it */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface SignInput {
  method: string;
  url: URL;
  /** extra headers to sign (host, x-amz-date and x-amz-content-sha256 are added) */
  headers?: Record<string, string>;
  /** hex sha256 of the body, or UNSIGNED_PAYLOAD */
  payloadHash: string;
  region: string;
  accessKey: string;
  secretKey: string;
  now?: Date;
}
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

/** headers to send (lower-case names), including Authorization */
export function signV4(i: SignInput): Record<string, string> {
  const now = i.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(i.headers ?? {})) h[k.toLowerCase()] = v.trim().replace(/\s+/g, ' ');
  h.host = i.url.host;
  h['x-amz-date'] = amzDate;
  h['x-amz-content-sha256'] = i.payloadHash;
  const names = Object.keys(h).sort();
  const canonicalHeaders = names.map((n) => `${n}:${h[n]}\n`).join('');
  const signed = names.join(';');
  const path = i.url.pathname.split('/').map((p) => enc(decodeURIComponent(p))).join('/') || '/';
  const query = [...i.url.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)] as const).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [i.method.toUpperCase(), path, query, canonicalHeaders, signed, i.payloadHash].join('\n');
  const scope = `${day}/${i.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${i.secretKey}`, day), i.region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  h.authorization = `AWS4-HMAC-SHA256 Credential=${i.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
  return h;
}

export interface S3Target { endpoint: string; bucket: string; region: string; accessKey: string; secretKey: string; prefix: string }

/** path-style address https://endpoint/bucket/prefix/name */
export function s3ObjectUrl(t: S3Target, name: string): URL {
  const u = new URL(t.endpoint);
  const prefix = t.prefix.replace(/^\/+|\/+$/g, '');
  u.pathname = `/${[t.bucket, prefix, name].filter(Boolean).map(enc).join('/')}`;
  u.search = '';
  u.username = '';
  u.password = '';
  return u;
}

/** validates the pieces entered in the panel; returns an error text or null */
export function s3Problem(t: Partial<S3Target>): string | null {
  try {
    if (new URL(t.endpoint ?? '').protocol !== 'https:') return 'Адрес хранилища должен начинаться с https://';
  } catch {
    return 'Адрес хранилища: например https://s3.eu-central-1.amazonaws.com';
  }
  if (!t.bucket || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,62}$/.test(t.bucket)) return 'Имя бакета: 2–63 символа, буквы, цифры, точка, дефис';
  if (!t.accessKey || !t.secretKey) return 'Нужны ключ доступа и секретный ключ';
  return null;
}
