/**
 * Web Push without a library: the panel's VAPID keys (RFC 8292), the encryption of a message for one browser
 * (RFC 8291, aes128gcm of RFC 8188) and the request to the browser's push service.
 *
 * The keys are made once and kept in the settings (the private one encrypted, like every *_secret).
 */
import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';

const b64u = (b: Buffer) => b.toString('base64url');

/** the panel's VAPID key pair: the public key as browsers want it (65 bytes, base64url) and the private one as PEM */
export function vapidKeys(): { publicKey: string; privatePem: string } {
  const pub = getSetting('push_vapid_public');
  const priv = getSetting('push_vapid_secret');
  if (pub && priv) return { publicKey: pub, privatePem: priv };
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]);
  const keys = { publicKey: b64u(raw), privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() };
  setSetting('push_vapid_public', keys.publicKey);
  setSetting('push_vapid_secret', keys.privatePem);
  return keys;
}

/** the VAPID header for one push service: a short ES256 token for its origin */
export function vapidAuth(endpoint: string, keys: { publicKey: string; privatePem: string }, subject: string, now = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: keys.privatePem, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, len: number) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

/**
 * Encrypts a message for one subscription (aes128gcm): the body is
 * salt(16) | record size(4) | key id length(1) | the server's one-time public key(65) | ciphertext + tag.
 */
export function encryptPayload(plain: Buffer, p256dh: string, authSecret: string, opts: { salt?: Buffer; ecdh?: crypto.ECDH } = {}): Buffer {
  const uaPublic = Buffer.from(p256dh, 'base64url');
  const auth = Buffer.from(authSecret, 'base64url');
  if (uaPublic.length !== 65 || auth.length < 16) throw new Error('bad subscription keys');
  const ecdh = opts.ecdh ?? crypto.createECDH('prime256v1');
  if (!opts.ecdh) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const ikm = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const salt = opts.salt ?? crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // one record: the message and the delimiter 0x02 (last record), no padding
  const body = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

export interface PushTarget { endpoint: string; p256dh: string; auth: string }
export type PushOutcome = 'sent' | 'gone' | 'failed';

/** sends one message; 'gone' means the browser dropped the subscription (404/410) and it should be forgotten */
export async function sendPush(t: PushTarget, message: Record<string, unknown>, subject: string): Promise<PushOutcome> {
  try {
    const keys = vapidKeys();
    const res = await fetch(t.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuth(t.endpoint, keys, subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'high',
      },
      body: new Uint8Array(encryptPayload(Buffer.from(JSON.stringify(message)), t.p256dh, t.auth)),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
