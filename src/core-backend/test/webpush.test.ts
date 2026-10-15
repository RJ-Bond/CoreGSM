/** Web Push: the message decrypts the way a browser does it, the VAPID token verifies, the API delivers and forgets. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { encryptPayload } from '../src/webpush.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

/** a browser's side: its key pair and auth secret, and the RFC 8291 decryption */
function browser() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const keys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
  const decrypt = (body: Buffer): string => {
    const salt = body.subarray(0, 16);
    const idlen = body.readUInt8(20);
    const asPublic = body.subarray(21, 21 + idlen);
    const shared = ecdh.computeSecret(asPublic);
    const h = (s: Buffer, k: Buffer, info: string | Buffer, n: number) => Buffer.from(crypto.hkdfSync('sha256', k, s, typeof info === 'string' ? Buffer.from(info) : info, n));
    const ikm = h(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]), 32);
    const cek = h(salt, ikm, 'Content-Encoding: aes128gcm\0', 16);
    const nonce = h(salt, ikm, 'Content-Encoding: nonce\0', 12);
    const data = body.subarray(21 + idlen);
    const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
    assert.equal(plain[plain.length - 1], 2, 'the last-record delimiter');
    return plain.subarray(0, plain.length - 1).toString();
  };
  return { keys, decrypt };
}

describe('web push encryption', () => {
  it('a browser decrypts the message', () => {
    const b = browser();
    const body = encryptPayload(Buffer.from('{"title":"Привет"}'), b.keys.p256dh, b.keys.auth);
    assert.equal(body.readUInt32BE(16), 4096);
    assert.equal(b.decrypt(body), '{"title":"Привет"}');
  });
  it('every message has its own salt and key', () => {
    const b = browser();
    const x = encryptPayload(Buffer.from('a'), b.keys.p256dh, b.keys.auth);
    const y = encryptPayload(Buffer.from('a'), b.keys.p256dh, b.keys.auth);
    assert.notDeepEqual(x.subarray(0, 86), y.subarray(0, 86));
  });
});

describe('api: push', () => {
  let api: Api;
  let token = '';
  let srv: http.Server;
  let base = '';
  let status = 201;
  const got: { headers: http.IncomingHttpHeaders; body: Buffer; path: string }[] = [];
  const b = browser();
  before(async () => {
    srv = http.createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on('data', (c) => parts.push(c));
      req.on('end', () => {
        got.push({ headers: req.headers, body: Buffer.concat(parts), path: req.url ?? '' });
        res.writeHead(status).end();
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    api = await startBackend();
    token = await setupAdmin(api);
  });
  after(async () => { srv.close(); await api.stop(); });

  it('a device subscribes; the test notification arrives encrypted and signed', async () => {
    const key = (await api.call('GET', '/api/push/key')).body.publicKey as string;
    assert.equal(Buffer.from(key, 'base64url').length, 65);
    assert.equal((await api.call('POST', '/api/push/subscribe', { body: { endpoint: `${base}/a`, keys: b.keys } })).status, 401);
    const r = await api.call('POST', '/api/push/subscribe', { token, body: { endpoint: `${base}/a`, keys: b.keys } });
    assert.equal(r.body.devices, 1);
    const t = await api.call('POST', '/api/push/test', { token });
    assert.equal(t.body.sent, 1);
    const m = got[0];
    assert.equal(m.headers['content-encoding'], 'aes128gcm');
    assert.match(JSON.parse(b.decrypt(m.body)).body, /Уведомления работают/);
    // the VAPID token: ES256 over header.payload with the panel's public key, for this push service's origin
    const auth = String(m.headers.authorization);
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(auth)!;
    assert.equal(k, key);
    const [h, p, s] = jwt.split('.');
    assert.equal(JSON.parse(Buffer.from(p, 'base64url').toString()).aud, base);
    const raw = Buffer.from(key, 'base64url');
    const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
    assert.equal(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), true);
  });

  it('a subscription the push service dropped (410) is forgotten', async () => {
    status = 410;
    assert.equal((await api.call('POST', '/api/push/test', { token })).body.sent, 0);
    status = 201;
    assert.equal((await api.call('POST', '/api/push/test', { token })).body.sent, 0);
    assert.equal(got.length, 2);
  });
});
