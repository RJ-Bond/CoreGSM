/** The bot's status line: the dot colour and the rotating lines. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildPresence, type PresenceServer } from '../src/presence.ts';
import { startBackend, type Api } from './harness.ts';

const sv = (name: string, o: Partial<PresenceServer> = {}): PresenceServer => ({ name, online: true, players: 0, maxPlayers: 20, hasStatus: true, ...o });

describe('bot presence (pure)', () => {
  it('green with the totals, every server (busiest first) and the commands hint', () => {
    const p = buildPresence([sv('A', { players: 5 }), sv('B', { players: 17, maxPlayers: 40 })]);
    assert.equal(p.status, 'online');
    assert.deepEqual(p.lines, ['22 игрока · 2/2 онлайн', 'B: 17/40', 'A: 5/20', '/status · /online · /top']);
  });
  it('yellow when one server is down, red when all are down; the offline ones go last', () => {
    const some = buildPresence([sv('Down', { online: false }), sv('Up', { players: 3 })]);
    assert.equal(some.status, 'idle');
    assert.deepEqual(some.lines.slice(0, 3), ['3 игрока · 1/2 онлайн', 'Up: 3/20', 'Down: офлайн']);
    assert.equal(buildPresence([sv('A', { online: false }), sv('B', { online: false })]).status, 'dnd');
  });
  it('a server that never answered is not a problem; no servers means just the hint', () => {
    assert.equal(buildPresence([sv('New', { hasStatus: false, online: false }), sv('Up', { players: 1 })]).status, 'online');
    assert.equal(buildPresence([sv('New', { hasStatus: false, online: false })]).lines[0], 'ждёт первого опроса серверов');
    assert.deepEqual(buildPresence([]), { status: 'online', lines: ['/register · /profile · /status'] });
  });
  it('declines the player word and trims long names', () => {
    assert.match(buildPresence([sv('A', { players: 1 })]).lines[0], /^1 игрок /);
    assert.match(buildPresence([sv('A', { players: 11 })]).lines[0], /^11 игроков /);
    assert.match(buildPresence([sv('A', { players: 21 })]).lines[0], /^21 игрок /);
    const long = buildPresence([sv('x'.repeat(200))]).lines[1];
    assert.ok(long.length <= 100);
  });
});

describe('bot presence (API)', () => {
  let api: Api;
  before(async () => { api = await startBackend(); });
  after(async () => { await api.stop(); });
  it('is internal: the token is required, an empty panel gives the hint', async () => {
    assert.ok([401, 403].includes((await api.call('GET', '/internal/presence')).status));
    const r = await api.call('GET', '/internal/presence', { headers: { 'x-internal-token': 'i'.repeat(48) } });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'online');
    assert.ok(Array.isArray(r.body.lines) && r.body.lines.length > 0);
  });
});
