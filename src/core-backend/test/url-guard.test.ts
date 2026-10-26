import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkWebhookUrl, isBlockedAddress, safeLookup } from '../src/urlGuard.ts';
import { botIsDown, parseRecipients, signBody, verifySignature, webhookBody, webhookHeaders, MAX_BODY_BYTES } from '../src/alertChannelsLogic.ts';

describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local, CGNAT, multicast and unspecified IPv4', () => {
    for (const a of ['127.0.0.1', '127.9.9.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255']) {
      assert.equal(isBlockedAddress(a), true, a);
    }
  });
  it('lets public IPv4 through', () => {
    for (const a of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '93.184.216.34']) assert.equal(isBlockedAddress(a), false, a);
  });
  it('blocks IPv6 loopback, unique local, link-local, multicast and mapped private addresses', () => {
    for (const a of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '[::1]', '64:ff9b::7f00:1']) {
      assert.equal(isBlockedAddress(a), true, a);
    }
  });
  it('lets public IPv6 and mapped public IPv4 through', () => {
    for (const a of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8']) assert.equal(isBlockedAddress(a), false, a);
  });
  it('anything that is not an address is blocked', () => {
    assert.equal(isBlockedAddress('example.com'), true);
    assert.equal(isBlockedAddress(''), true);
  });
});

describe('checkWebhookUrl', () => {
  it('accepts http and https to a public name or address', () => {
    assert.equal(checkWebhookUrl('https://hooks.example.com/abc?x=1').ok, true);
    assert.equal(checkWebhookUrl('http://8.8.8.8:8080/h').ok, true);
  });
  it('rejects other schemes, credentials, empty and broken text', () => {
    for (const u of ['ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'gopher://example.com', 'https://user:pw@example.com/', '', 'not a url', 'https://', 'a'.repeat(501)]) {
      assert.equal(checkWebhookUrl(u).ok, false, u);
    }
  });
  it('rejects local addresses and names, in every spelling the URL parser normalises', () => {
    for (const u of ['http://127.0.0.1/', 'http://localhost/', 'http://LOCALHOST:3000/', 'http://[::1]/', 'http://2130706433/', 'http://0x7f.1/', 'http://127.1/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://192.168.0.1/', 'http://[::ffff:127.0.0.1]/', 'http://printer.local/', 'http://db.internal/', 'http://intranet/', 'http://foo.localhost/']) {
      assert.equal(checkWebhookUrl(u).ok, false, u);
    }
  });
  it('allowPrivate (the owner decides) lets local addresses through, but never other schemes', () => {
    assert.equal(checkWebhookUrl('http://127.0.0.1:9000/', true).ok, true);
    assert.equal(checkWebhookUrl('http://localhost/', true).ok, true);
    assert.equal(checkWebhookUrl('file:///etc/passwd', true).ok, false);
  });
});

describe('signature', () => {
  it('is HMAC-SHA256 of «timestamp.body» and verifies', () => {
    const body = '{"a":1}';
    const sig = signBody('s3cret', 1_700_000_000, body);
    assert.match(sig, /^[0-9a-f]{64}$/);
    const now = 1_700_000_100_000;
    assert.equal(verifySignature('s3cret', 1_700_000_000, body, `sha256=${sig}`, now), true);
    assert.equal(verifySignature('other', 1_700_000_000, body, `sha256=${sig}`, now), false);
    assert.equal(verifySignature('s3cret', 1_700_000_000, body + ' ', `sha256=${sig}`, now), false);
    assert.equal(verifySignature('s3cret', 1_700_000_000, body, `sha256=${sig}`, now + 3600_000), false); // too old: replay
  });
  it('headers carry the event, the delivery id, the time and the signature only when there is a secret', () => {
    const body = webhookBody({ event: 'server_down', title: 't', text: '', data: {} }, 5, 77);
    const h = webhookHeaders('k', 5, body, 'server_down', 77);
    assert.equal(h['X-CoreGSM-Timestamp'], '5');
    assert.equal(h['X-CoreGSM-Event'], 'server_down');
    assert.equal(h['X-CoreGSM-Signature'], `sha256=${signBody('k', 5, body)}`);
    assert.equal(webhookHeaders('', 5, body, 'x', 1)['X-CoreGSM-Signature'], undefined);
  });
  it('an oversized body is cut down to the message', () => {
    const body = webhookBody({ event: 'wipe', title: 'T', text: 'x'.repeat(50_000), data: { big: 'y'.repeat(50_000) } }, 1, 1);
    assert.ok(Buffer.byteLength(body) <= MAX_BODY_BYTES);
    assert.equal(JSON.parse(body).truncated, true);
  });
});

describe('parseRecipients', () => {
  it('splits, trims, drops duplicates and reports the bad ones', () => {
    const r = parseRecipients('a@x.ru, B@y.com; a@X.ru nope  c@@d.com');
    assert.deepEqual(r.ok, ['a@x.ru', 'B@y.com']);
    assert.deepEqual(r.bad, ['nope', 'c@@d.com']);
  });
});

describe('safeLookup', () => {
  const look = (allow: boolean) =>
    new Promise<{ err: (Error & { code?: string }) | null; address: unknown }>((resolve) => {
      safeLookup(allow)('localhost', {}, (err, address) => resolve({ err, address }));
    });
  it('refuses a name that resolves to the local machine, so a name cannot lead into the network', async () => {
    const r = await look(false);
    assert.equal(r.err?.code, 'EBLOCKED');
  });
  it('allows it when the owner allowed private addresses', async () => {
    const r = await look(true);
    assert.equal(r.err, null);
    assert.match(String(r.address), /^(127\.0\.0\.1|::1)$/);
  });
});

describe('botIsDown', () => {
  const now = 1_000_000;
  it('no token, no problem', () => assert.equal(botIsDown({ state: 'idle', updatedAt: 0 }, false, now), false));
  it('online and fresh is fine; error, idle and a silent bot are down', () => {
    assert.equal(botIsDown({ state: 'online', updatedAt: now - 10_000 }, true, now), false);
    assert.equal(botIsDown({ state: 'error', updatedAt: now - 1000 }, true, now), true);
    assert.equal(botIsDown({ state: 'idle', updatedAt: 0 }, true, now), true);
    assert.equal(botIsDown({ state: 'online', updatedAt: now - 120_000 }, true, now), true);
  });
});
