/**
 * Mafia II: Online. The server answers over HTTP (TCP, game port + 1) with its version and slots; its name and the
 * players are only in the public masterlist. The samples below are the real formats: the info endpoint of
 * MafiaHub/Framework (integrations/server/instance.cpp) and masterlist.mafiahub.dev/servers.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { parseM2oInfo } from '../src/m2oInfo.ts';
import { parseMasterlist, setMasterlistSource } from '../src/m2oMasterlist.ts';

process.env.NODE_ENV = 'test';
const { queryServer } = await import('../src/query.ts');
const { GAME_PROFILES } = await import('../src/games.ts');

/** what GET / of a server answers (the keys of instance.cpp) */
const INFO = {
  mod_name: 'M2O', mod_slug: 'm2o', mod_version: '1.6.0', framework_version: '0.9.1', host: '0.0.0.0', port: 27015,
  password_required: false, max_players: 32, mod_config: { season: 'summer' },
};
/** one entry of the masterlist, as it really is */
const entry = (o: Record<string, unknown> = {}) => ({
  id: 'x', logo_url: '', metadata: [], name: '[RU] Mafia II Role Play', localization: 'EU', language: 'RU', gamemode: 'M2O',
  current_players: 16, max_players: 1000, version: '1.6.0', ip: '127.0.0.1', port: 27015, passworded: false, last_ping: new Date().toISOString(), ...o,
});

describe('Mafia II: Online info parsing (the real keys)', () => {
  it('reads the version of the mod and the slots; there is no name and no player count in this answer', () => {
    assert.deepEqual(parseM2oInfo(INFO), { name: null, players: 0, maxPlayers: 32, map: null, version: '1.6.0', playerNames: [] });
  });
  it('still accepts other spellings and ignores nonsense', () => {
    assert.equal(parseM2oInfo({ numplayers: 4 })?.players, 4);
    assert.equal(parseM2oInfo({ name: 'Vito RP', maxplayers: '20', players: [{ name: 'Joe' }, 'Vito'] })?.playerNames.length, 2);
    assert.equal(parseM2oInfo({ players: -3, max_players: 'many' })?.maxPlayers, 0);
    assert.equal(parseM2oInfo({})?.players, 0, 'an empty object still proves the server answers');
  });
  it('refuses what is not a JSON object', () => {
    assert.equal(parseM2oInfo(null), null);
    assert.equal(parseM2oInfo([1, 2]), null);
    assert.equal(parseM2oInfo('up'), null);
  });
  it('the game is in the profile list with the ports and the masterlist explained', () => {
    const p = GAME_PROFILES.find((g) => g.id === 'm2o');
    assert.ok(p);
    assert.equal(p.defaultPort, 27015);
    assert.match(p.queryPortHint ?? '', /27016/);
    assert.match(p.queryPortHint ?? '', /мастер-лист/);
  });
});

describe('Mafia II: Online masterlist parsing', () => {
  it('keeps only the Mafia II: Online servers of the shared list, with the fields the panel needs', () => {
    const list = parseMasterlist([entry(), entry({ gamemode: 'HogwartsMP', name: 'Castle' }), entry({ ip: '' }), null, 'x', entry({ gamemode: 'm2o', name: 'Lowercase', port: 24015, passworded: true })]);
    assert.deepEqual(list.map((e) => [e.name, e.port, e.passworded]), [['[RU] Mafia II Role Play', 27015, false], ['Lowercase', 24015, true]]);
    assert.equal(list[0].players, 16);
    assert.equal(list[0].maxPlayers, 1000);
    assert.equal(list[0].version, '1.6.0');
    assert.ok(list[0].lastPing > 0);
  });
  it('is empty for anything that is not an array', () => {
    assert.deepEqual(parseMasterlist(null), []);
    assert.deepEqual(parseMasterlist({ servers: [] }), []);
  });
});

describe('Mafia II: Online over HTTP and the masterlist (local fakes)', () => {
  let srv: http.Server;
  let infoPort = 0;
  let mode: 'root' | 'info' | 'down' = 'root';
  before(async () => {
    srv = http.createServer((req, res) => {
      if (mode === 'down') return void res.destroy();
      if (mode === 'info' && req.url !== '/info') { res.statusCode = 404; return void res.end('no'); }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(INFO));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    infoPort = (srv.address() as AddressInfo).port;
  });
  after(async () => {
    setMasterlistSource(null);
    await new Promise<void>((r) => srv.close(() => r()));
  });
  beforeEach(() => { mode = 'root'; setMasterlistSource(async () => []); });

  const gamePort = () => infoPort - 1;
  const q = () => queryServer({ game: 'm2o', host: '127.0.0.1', port: gamePort(), query_port: null });

  it('without the masterlist: online with the version and slots; the name and the players are unknown', async () => {
    const r = await q();
    assert.equal(r.online, true);
    assert.equal(r.name, null);
    assert.equal(r.version, '1.6.0');
    assert.equal(r.maxPlayers, 32);
    assert.equal(r.players, 0);
    assert.ok(typeof r.ping === 'number');
  });

  it('with the masterlist entry of the server (same IP and port): its name and the players', async () => {
    setMasterlistSource(async () => [entry({ port: gamePort() })]);
    const r = await q();
    assert.equal(r.online, true);
    assert.equal(r.name, '[RU] Mafia II Role Play');
    assert.equal(r.players, 16);
    assert.equal(r.maxPlayers, 32, 'the slots of the server itself win');
    assert.equal(r.version, '1.6.0');
  });

  it('an entry of another server (other port) is not taken', async () => {
    setMasterlistSource(async () => [entry({ port: gamePort() + 5 })]);
    const r = await q();
    assert.equal(r.name, null);
    assert.equal(r.players, 0);
  });

  it('a stale entry gives the name but not the players', async () => {
    setMasterlistSource(async () => [entry({ port: gamePort(), last_ping: new Date(Date.now() - 3600_000).toISOString() })]);
    const r = await q();
    assert.equal(r.name, '[RU] Mafia II Role Play');
    assert.equal(r.players, 0);
  });

  it('HTTP closed but announcing itself in the masterlist: online, everything from the list', async () => {
    mode = 'down';
    setMasterlistSource(async () => [entry({ port: gamePort() })]);
    const r = await q();
    assert.equal(r.online, true);
    assert.equal(r.name, '[RU] Mafia II Role Play');
    assert.equal(r.players, 16);
    assert.equal(r.maxPlayers, 1000);
    assert.equal(r.ping, null);
  });

  it('a masterlist that cannot be fetched does not break the poll', async () => {
    setMasterlistSource(async () => { throw new Error('masterlist down'); });
    const r = await q();
    assert.equal(r.online, true);
    assert.equal(r.version, '1.6.0');
  });

  it('falls back to /info when / answers with an error', async () => {
    mode = 'info';
    const r = await q();
    assert.equal(r.online, true);
    assert.equal(r.maxPlayers, 32);
  });
});
