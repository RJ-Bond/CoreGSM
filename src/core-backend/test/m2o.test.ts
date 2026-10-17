/** Mafia II: Online: the HTTP info endpoint (TCP, game port + 1) is read tolerantly and counts as «server is up». */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { parseM2oInfo } from '../src/m2oInfo.ts';

process.env.NODE_ENV = 'test';
const { queryServer } = await import('../src/query.ts');
const { GAME_PROFILES } = await import('../src/games.ts');

describe('Mafia II: Online info parsing', () => {
  it('reads the keys of the documented metadata (max_players, mod) and a player count', () => {
    const i = parseM2oInfo({ host: '0.0.0.0', max_players: 32, players: 7, password: false, mod: { name: 'freeroam', version: '1.6.0', map: 'Empire Bay' } });
    assert.deepEqual(i, { name: null, players: 7, maxPlayers: 32, map: 'Empire Bay', version: '1.6.0', playerNames: [] });
  });
  it('takes a list of players: the count and the names', () => {
    const i = parseM2oInfo({ name: 'Vito RP', maxplayers: '20', players: [{ name: 'Joe' }, 'Vito', { nick: 'x' }] });
    assert.equal(i?.name, 'Vito RP');
    assert.equal(i?.maxPlayers, 20);
    assert.equal(i?.players, 3);
    assert.deepEqual(i?.playerNames, ['Joe', 'Vito']);
  });
  it('accepts other usual spellings and ignores nonsense', () => {
    assert.equal(parseM2oInfo({ numplayers: 4 })?.players, 4);
    assert.equal(parseM2oInfo({ playerCount: 5 })?.players, 5);
    assert.equal(parseM2oInfo({ players: -3, max_players: 'many' })?.players, 0);
    assert.equal(parseM2oInfo({ players: -3, max_players: 'many' })?.maxPlayers, 0);
    assert.equal(parseM2oInfo({})?.players, 0, 'an empty object still proves the server answers');
  });
  it('refuses what is not a JSON object', () => {
    assert.equal(parseM2oInfo(null), null);
    assert.equal(parseM2oInfo([1, 2]), null);
    assert.equal(parseM2oInfo('up'), null);
  });
  it('the game is in the profile list with both ports explained', () => {
    const p = GAME_PROFILES.find((g) => g.id === 'm2o');
    assert.ok(p);
    assert.equal(p.defaultPort, 27015);
    assert.match(p.queryPortHint ?? '', /27016/);
  });
});

describe('Mafia II: Online over HTTP (a local fake server)', () => {
  let srv: http.Server;
  let infoPort = 0;
  let mode: 'root' | 'info' | 'down' | 'html' = 'root';
  before(async () => {
    srv = http.createServer((req, res) => {
      if (mode === 'down') return void res.destroy();
      const json = JSON.stringify({ name: 'Empire Bay RP', max_players: 32, players: [{ name: 'Joe' }, { name: 'Vito' }], mod: { version: '1.6.0' } });
      if (mode === 'html') { res.setHeader('content-type', 'text/html'); return void res.end('<html>nope</html>'); }
      if (mode === 'info' && req.url !== '/info') { res.statusCode = 404; return void res.end('no'); }
      res.setHeader('content-type', 'application/json');
      res.end(json);
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    infoPort = (srv.address() as AddressInfo).port;
  });
  after(() => new Promise<void>((r) => srv.close(() => r())));

  const q = () => queryServer({ game: 'm2o', host: '127.0.0.1', port: infoPort - 1, query_port: null });

  it('is online with the players, the name and the version from the JSON at /', async () => {
    mode = 'root';
    const r = await q();
    assert.equal(r.online, true);
    assert.equal(r.name, 'Empire Bay RP');
    assert.equal(r.players, 2);
    assert.equal(r.maxPlayers, 32);
    assert.equal(r.version, '1.6.0');
    assert.deepEqual(r.playerNames, ['Joe', 'Vito']);
    assert.ok(typeof r.ping === 'number');
  });

  it('falls back to /info when / answers with an error', async () => {
    mode = 'info';
    const r = await q();
    assert.equal(r.online, true);
    assert.equal(r.players, 2);
  });
});
