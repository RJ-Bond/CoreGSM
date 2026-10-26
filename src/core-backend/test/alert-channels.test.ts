/** Extra alert channels: webhooks (signature, SSRF, retries state) and e-mail; the «N of M» setting. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { verifySignature } from '../src/alertChannelsLogic.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

interface Hit { headers: http.IncomingHttpHeaders; body: string }

describe('api: alert channels', () => {
  let api: Api;
  let token = '';
  let recv: http.Server;
  let recvUrl = '';
  const hits: Hit[] = [];
  let answer = 200;
  const mailFile = path.join(os.tmpdir(), `coregsm-chmail-${process.pid}.jsonl`);

  before(async () => {
    recv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        hits.push({ headers: req.headers, body });
        res.statusCode = answer;
        res.end('ok');
      });
    });
    await new Promise<void>((r) => recv.listen(0, '127.0.0.1', r));
    recvUrl = `http://127.0.0.1:${(recv.address() as { port: number }).port}/hook`;
    fs.rmSync(mailFile, { force: true });
    api = await startBackend({ MAIL_DEBUG_FILE: mailFile });
    token = await setupAdmin(api);
  });
  after(async () => {
    await api.stop();
    recv.close();
    fs.rmSync(mailFile, { force: true });
  });

  const waitHits = async (n: number, ms = 12_000) => {
    const t = Date.now();
    while (hits.length < n && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 100));
  };
  const hook = (over: Record<string, unknown> = {}) => ({ kind: 'webhook', name: 'Мой вебхук', url: recvUrl, secret: 'top-secret-value', events: ['server_down', 'server_up'], allowPrivate: true, ...over });

  it('requires an administrator', async () => {
    assert.equal((await api.call('GET', '/api/alert-channels')).status, 401);
    assert.equal((await api.call('POST', '/api/alert-channels', { body: hook() })).status, 401);
  });

  it('refuses a local address unless the owner allowed it, and other schemes always', async () => {
    const a = await api.call('POST', '/api/alert-channels', { token, body: hook({ allowPrivate: false }) });
    assert.equal(a.status, 400);
    assert.match(a.body.error, /локальн|служебн|запрещ/i);
    for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'http://169.254.169.254/latest', 'http://localhost/x']) {
      assert.equal((await api.call('POST', '/api/alert-channels', { token, body: hook({ url, allowPrivate: false }) })).status, 400, url);
    }
    assert.equal((await api.call('POST', '/api/alert-channels', { token, body: hook({ url: 'file:///etc/passwd' }) })).status, 400);
    assert.equal((await api.call('POST', '/api/alert-channels', { token, body: hook({ events: ['nope'] }) })).status, 400);
  });

  let id = 0;
  it('creates a channel, never shows the secret or the full address, and keeps the secret on edit', async () => {
    const r = await api.call('POST', '/api/alert-channels', { token, body: hook() });
    assert.equal(r.status, 201);
    id = r.body.id;
    const list = (await api.call('GET', '/api/alert-channels', { token })).body;
    assert.equal(list.items.length, 1);
    const c = list.items[0];
    assert.equal(c.hasSecret, true);
    assert.equal(JSON.stringify(list).includes('top-secret-value'), false);
    assert.equal(JSON.stringify(list).includes('/hook'), false);
    assert.match(c.urlPreview, /^http:\/\/127\.0\.0\.1:\d+\/…$/);
    assert.deepEqual(c.events, ['server_down', 'server_up']);
    assert.ok(list.events.some((e: { id: string }) => e.id === 'bot_down'));
    // the secret is encrypted at rest
    const d = new Database(api.dbPath, { readonly: true });
    const raw = d.prepare('SELECT secret FROM alert_channels WHERE id = ?').get(id) as { secret: string };
    d.close();
    assert.match(raw.secret, /^enc:v1:/);
    // an edit without a secret and without an address keeps both
    const e = await api.call('PUT', `/api/alert-channels/${id}`, { token, body: { kind: 'webhook', name: 'Переименован', events: ['server_down'] } });
    assert.equal(e.status, 200);
    assert.equal(e.body.items[0].hasSecret, true);
    assert.equal(e.body.items[0].name, 'Переименован');
    assert.equal((await api.call('PUT', `/api/alert-channels/${id}`, { token, body: { kind: 'email', name: 'x', recipients: 'a@b.cc', events: [] } })).status, 400);
    assert.equal((await api.call('PUT', '/api/alert-channels/9999', { token, body: hook() })).status, 404);
  });

  it('the test button delivers a signed JSON message and records the result', async () => {
    hits.length = 0;
    const r = await api.call('POST', `/api/alert-channels/${id}/test`, { token });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.items[0].lastStatus, 'ok');
    assert.equal(hits.length, 1);
    const h = hits[0]!;
    const sig = String(h.headers['x-coregsm-signature']);
    assert.match(sig, /^sha256=[0-9a-f]{64}$/);
    assert.equal(verifySignature('top-secret-value', Number(h.headers['x-coregsm-timestamp']), h.body, sig), true);
    const j = JSON.parse(h.body);
    assert.equal(j.event, 'test');
    assert.equal(h.headers['x-coregsm-event'], 'test');
    assert.match(String(h.headers['content-type']), /application\/json/);
  });

  it('a receiver that fails is reported with the reason', async () => {
    answer = 500;
    const r = await api.call('POST', `/api/alert-channels/${id}/test`, { token });
    answer = 200;
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /500/);
    assert.equal(r.body.items[0].lastStatus, 'error');
    assert.match(r.body.items[0].lastError, /500/);
  });

  it('a name that points to the local network is refused at the connection when private addresses are not allowed', async () => {
    // allowed when saving (public-looking name check passes in the logic), but localhost-style names are refused up front
    const d = new Database(api.dbPath);
    d.prepare("INSERT INTO alert_channels (kind, name, url, events, enabled, allow_private, created_at) VALUES ('webhook', 'sneaky', ?, '[]', 1, 0, ?)").run(recvUrl, Date.now());
    const sneaky = Number((d.prepare('SELECT last_insert_rowid() AS i').get() as { i: number }).i);
    d.close();
    hits.length = 0;
    const r = await api.call('POST', `/api/alert-channels/${sneaky}/test`, { token });
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /локальн|служебн|запрещ/i);
    assert.equal(hits.length, 0);
    await api.call('DELETE', `/api/alert-channels/${sneaky}`, { token });
  });

  it('e-mail: needs recipients, sends a letter with the common SMTP settings', async () => {
    assert.equal((await api.call('POST', '/api/alert-channels', { token, body: { kind: 'email', name: 'Почта', recipients: '', events: ['server_down'] } })).status, 400);
    assert.equal((await api.call('POST', '/api/alert-channels', { token, body: { kind: 'email', name: 'Почта', recipients: 'not-an-address', events: [] } })).status, 400);
    const r = await api.call('POST', '/api/alert-channels', { token, body: { kind: 'email', name: 'Почта', recipients: 'admin@example.com, ops@example.com', events: ['server_down', 'bot_down'] } });
    assert.equal(r.status, 201);
    const t = await api.call('POST', `/api/alert-channels/${r.body.id}/test`, { token });
    assert.equal(t.body.ok, true);
    const lines = fs.readFileSync(mailFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const m = lines.at(-1);
    assert.equal(m.to, 'admin@example.com, ops@example.com');
    assert.match(m.subject, /Проверка оповещений/);
    await api.call('DELETE', `/api/alert-channels/${r.body.id}`, { token });
  });

  it('a server going down is announced to the webhook even when Discord alerts are off', async () => {
    hits.length = 0;
    const d = new Database(api.dbPath);
    const srv = Number(d.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('Точка', 'minecraft', '127.0.0.1', 1, ?)").run(Date.now()).lastInsertRowid);
    d.prepare('INSERT INTO status (server_id, online, players, max_players, ping, updated_at) VALUES (?, 0, 0, 0, NULL, ?)').run(srv, Date.now());
    // the outage began 10 minutes ago (the grace period is 3)
    d.prepare('INSERT INTO alert_state (server_id, down_since, alerted) VALUES (?, ?, 0)').run(srv, Date.now() - 10 * 60_000);
    d.close();
    // the channel listens to server_down again
    await api.call('PUT', `/api/alert-channels/${id}`, { token, body: { kind: 'webhook', name: 'Мой вебхук', events: ['server_down'] } });
    const rf = await api.call('POST', `/api/servers/${srv}/refresh`, { token });
    assert.equal(rf.status, 200);
    await waitHits(1);
    assert.equal(hits.length, 1);
    const j = JSON.parse(hits[0]!.body);
    assert.equal(j.event, 'server_down');
    assert.equal(j.data.server, 'Точка');
    assert.match(j.title, /недоступен/);
    // it went through the common delivery queue
    const q = (await api.call('GET', '/api/deliveries?kind=webhook', { token })).body;
    assert.ok(q.items.some((x: { status: string; kind: string }) => x.kind === 'webhook' && x.status === 'sent'));
    // the Discord side stayed silent (alerts are off)
    const dd = new Database(api.dbPath, { readonly: true });
    assert.equal((dd.prepare("SELECT COUNT(*) AS n FROM alerts WHERE kind = 'down'").get() as { n: number }).n, 0);
    dd.close();
  });

  it('a failing receiver is retried through the queue (state «error», next try scheduled)', async () => {
    const d = new Database(api.dbPath);
    d.prepare("DELETE FROM alert_state").run();
    d.close();
    answer = 503;
    const before = hits.length;
    const dbw = new Database(api.dbPath);
    const srv = (dbw.prepare('SELECT id FROM servers LIMIT 1').get() as { id: number }).id;
    dbw.prepare('INSERT INTO alert_state (server_id, down_since, alerted) VALUES (?, ?, 0)').run(srv, Date.now() - 10 * 60_000);
    dbw.close();
    await api.call('POST', `/api/servers/${srv}/refresh`, { token });
    await waitHits(before + 1);
    answer = 200;
    assert.ok(hits.length > before);
    const q = (await api.call('GET', '/api/deliveries?kind=webhook&status=error', { token })).body;
    assert.ok(q.items.length >= 1);
    assert.ok(q.items[0].nextTryAt > Date.now());
    const c = (await api.call('GET', '/api/alert-channels', { token })).body.items[0];
    assert.equal(c.lastStatus, 'error');
  });

  it('delete removes the channel and the audit log has the actions', async () => {
    assert.equal((await api.call('DELETE', `/api/alert-channels/${id}`, { token })).status, 200);
    assert.equal((await api.call('DELETE', `/api/alert-channels/${id}`, { token })).status, 404);
    assert.equal((await api.call('GET', '/api/alert-channels', { token })).body.items.length, 0);
    const d = new Database(api.dbPath, { readonly: true });
    const labels = (d.prepare('SELECT action FROM audit').all() as { action: string }[]).map((x) => x.action);
    d.close();
    for (const l of ['Добавлен канал оповещений', 'Изменён канал оповещений', 'Тест канала оповещений', 'Удалён канал оповещений']) assert.ok(labels.includes(l), l);
  });
});

describe('api: e-mail channel without SMTP', () => {
  let api: Api;
  let token = '';
  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
  });
  after(async () => { await api.stop(); });

  it('cannot be enabled and says why', async () => {
    const r = await api.call('POST', '/api/alert-channels', { token, body: { kind: 'email', name: 'Почта', recipients: 'a@example.com', events: ['server_down'] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /SMTP/);
    assert.equal((await api.call('GET', '/api/alert-channels', { token })).body.smtpReady, false);
    // saved switched off, it cannot be turned on later and a test explains the problem
    const off = await api.call('POST', '/api/alert-channels', { token, body: { kind: 'email', name: 'Почта', recipients: 'a@example.com', events: [], enabled: false } });
    assert.equal(off.status, 201);
    const t = await api.call('POST', `/api/alert-channels/${off.body.id}/test`, { token });
    assert.equal(t.body.ok, false);
    assert.match(t.body.error, /SMTP/);
    assert.equal((await api.call('PUT', `/api/alert-channels/${off.body.id}`, { token, body: { kind: 'email', name: 'Почта', recipients: 'a@example.com', events: [], enabled: true } })).status, 409);
  });
});

describe('api: poll rule «N of M»', () => {
  let api: Api;
  let token = '';
  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
  });
  after(async () => { await api.stop(); });

  it('defaults follow the threshold; own values are validated, kept and reset', async () => {
    let g = (await api.call('GET', '/api/settings/poll', { token })).body;
    assert.deepEqual([g.failN, g.failM, g.probeVeto], [null, null, false]);
    assert.deepEqual(g.rule, { n: 2, m: 2, probeVeto: false, custom: false });
    const p = await api.call('PUT', '/api/settings/poll', { token, body: { failN: 3, failM: 5, probeVeto: true } });
    assert.equal(p.status, 200);
    assert.deepEqual(p.body.rule, { n: 3, m: 5, probeVeto: true, custom: true });
    assert.equal((await api.call('PUT', '/api/settings/poll', { token, body: { failN: 0 } })).status, 400);
    assert.equal((await api.call('PUT', '/api/settings/poll', { token, body: { failM: 21 } })).status, 400);
    // n above m is cut down
    g = (await api.call('PUT', '/api/settings/poll', { token, body: { failN: 9, failM: 4 } })).body;
    assert.deepEqual([g.rule.n, g.rule.m], [4, 4]);
    g = (await api.call('PUT', '/api/settings/poll', { token, body: { failN: null, failM: null, probeVeto: false } })).body;
    assert.deepEqual(g.rule, { n: 2, m: 2, probeVeto: false, custom: false });
  });
});
