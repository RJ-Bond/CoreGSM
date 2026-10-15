/** Scheduled restarts: the RCON client against a fake server, when a restart happens, and the API. */
import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { decodePackets, encodePacket, rconCommand } from '../src/rcon.ts';
import { defaultSay, nextRun } from '../src/restartLogic.ts';
import { zonedTime } from '../src/localTime.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

/** a fake Source RCON server: password «secret»; «long» answers in two packets; every command is remembered */
function fakeRcon(): Promise<{ port: number; commands: string[]; close: () => void }> {
  const commands: string[] = [];
  const srv = net.createServer((sock) => {
    let buf: Buffer = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { packets, rest } = decodePackets(buf);
      buf = rest;
      for (const p of packets) {
        if (p.type === 3) {
          sock.write(encodePacket(p.id, 0, ''));
          sock.write(encodePacket(p.body === 'secret' ? p.id : -1, 2, ''));
        } else if (p.type === 2) {
          commands.push(p.body);
          if (p.body === 'long') {
            sock.write(encodePacket(p.id, 0, 'part one, '));
            setTimeout(() => sock.write(encodePacket(p.id, 0, 'part two')), 50);
          } else if (p.body !== 'quiet') sock.write(encodePacket(p.id, 0, `ok: ${p.body}`));
        }
      }
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ port: (srv.address() as net.AddressInfo).port, commands, close: () => srv.close() })));
}

describe('rcon client', () => {
  let fake: Awaited<ReturnType<typeof fakeRcon>>;
  before(async () => { fake = await fakeRcon(); });
  after(() => fake.close());

  it('signs in and runs a command; a long answer is joined; a silent command ends quietly', async () => {
    assert.equal(await rconCommand('127.0.0.1', fake.port, 'secret', 'status'), 'ok: status');
    assert.equal(await rconCommand('127.0.0.1', fake.port, 'secret', 'long'), 'part one, part two');
    assert.equal(await rconCommand('127.0.0.1', fake.port, 'secret', 'quiet'), '');
  });

  it('a wrong password and a closed port are clear errors', async () => {
    await assert.rejects(rconCommand('127.0.0.1', fake.port, 'nope', 'status'), /неверный пароль/);
    await assert.rejects(rconCommand('127.0.0.1', 1, 'x', 'status', 2000), /порт закрыт|RCON/);
  });

  it('packets: split across reads, garbage refused', () => {
    const two = Buffer.concat([encodePacket(7, 0, 'a'), encodePacket(8, 0, 'bc')]);
    const first = decodePackets(two.subarray(0, 20));
    assert.equal(first.packets.length, 1);
    const second = decodePackets(Buffer.concat([first.rest, two.subarray(20)]));
    assert.deepEqual(second.packets.map((p) => p.body), ['bc']);
    assert.throws(() => decodePackets(Buffer.from([1, 0, 0, 0, 0, 0, 0, 0])));
  });
});

describe('restart schedule', () => {
  const MSK = 'Europe/Moscow';
  it('the local time of a day in a zone', () => {
    assert.equal(zonedTime('2026-10-15', 6 * 60, MSK), Date.UTC(2026, 9, 15, 3, 0));
    assert.equal(zonedTime('2026-10-15', 6 * 60, 'UTC'), Date.UTC(2026, 9, 15, 6, 0));
  });
  it('the next run: today if still ahead, else the next ticked day', () => {
    const thuNoonMsk = Date.UTC(2026, 9, 15, 9, 0); // Thursday 12:00 in Moscow
    assert.equal(nextRun({ days: 127, at_min: 18 * 60 }, thuNoonMsk, MSK), Date.UTC(2026, 9, 15, 15, 0));
    assert.equal(nextRun({ days: 127, at_min: 6 * 60 }, thuNoonMsk, MSK), Date.UTC(2026, 9, 16, 3, 0));
    // Mondays only (bit 0): the next Monday is the 19th
    assert.equal(nextRun({ days: 1, at_min: 6 * 60 }, thuNoonMsk, MSK), Date.UTC(2026, 9, 19, 3, 0));
    assert.equal(nextRun({ days: 0, at_min: 0 }, thuNoonMsk, MSK), null);
  });
  it('the chat command fits the game', () => {
    assert.equal(defaultSay('vrising'), 'announce {text}');
    assert.equal(defaultSay('minecraft'), 'say {text}');
  });
});

describe('api: restarts', () => {
  let api: Api;
  let token = '';
  let fake: Awaited<ReturnType<typeof fakeRcon>>;
  let id = 0;
  before(async () => {
    fake = await fakeRcon();
    api = await startBackend();
    token = await setupAdmin(api);
    const db = new Database(api.dbPath);
    id = Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('A', 'vrising', '127.0.0.1', 9876, ?)").run(Date.now()).lastInsertRowid);
    db.close();
  });
  after(async () => { fake.close(); await api.stop(); });

  it('the plan: defaults, saving, the next run', async () => {
    let r = await api.call('GET', `/api/servers/${id}/restart`, { token });
    assert.equal(r.status, 200);
    assert.equal(r.body.enabled, false);
    assert.equal(r.body.say, 'announce {text}');
    assert.equal(r.body.rcon.configured, false);
    r = await api.call('PUT', `/api/servers/${id}/restart`, { token, body: { enabled: true, days: 127, atMin: 300, durationMin: 15, warnMin: 10, channelId: '', command: 'shutdown', say: 'announce {text}' } });
    assert.equal(r.status, 200);
    assert.ok(r.body.next > Date.now() && r.body.next <= Date.now() + 25 * 3600_000);
    assert.equal((await api.call('PUT', `/api/servers/${id}/restart`, { token, body: { enabled: true, days: 200, atMin: 0, durationMin: 1, warnMin: 0, channelId: '', command: '', say: '' } })).status, 400);
  });

  it('RCON: the password is kept secret; the test command runs on the server', async () => {
    let r = await api.call('PUT', `/api/servers/${id}/rcon`, { token, body: { port: fake.port } });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'rcon_password_required');
    r = await api.call('PUT', `/api/servers/${id}/rcon`, { token, body: { port: fake.port, password: 'secret' } });
    assert.deepEqual(r.body.rcon, { port: fake.port, configured: true });
    assert.equal(JSON.stringify(r.body).includes('secret'), false);
    const db = new Database(api.dbPath);
    assert.match((db.prepare('SELECT password FROM server_rcon').get() as { password: string }).password, /^enc:v1:/);
    db.close();
    r = await api.call('POST', `/api/servers/${id}/rcon/test`, { token, body: { command: 'status' } });
    assert.deepEqual(r.body, { ok: true, answer: 'ok: status' });
  });

  it('restart now: a maintenance window and the command over RCON', async () => {
    const r = await api.call('POST', `/api/servers/${id}/restart/now`, { token });
    assert.equal(r.status, 200);
    assert.match(r.body.lastResult, /ok: shutdown/);
    assert.ok(fake.commands.includes('shutdown'));
    const db = new Database(api.dbPath);
    const w = db.prepare('SELECT * FROM maintenance_windows WHERE server_id = ?').get(id) as { start_ts: number; end_ts: number; name: string };
    db.close();
    assert.equal(w.name, 'Плановый перезапуск');
    assert.ok(w.end_ts - w.start_ts >= 15 * 60_000);
  });
});
