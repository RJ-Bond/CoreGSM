/** The journal of joins and departures from the game plugin, the alert about many timeouts, what the plugin could not patch. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-conn-'));
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ??= 'i'.repeat(48);
const { db } = await import('../src/db.ts');
const conn = await import('../src/gamenews/gameNewsConnections.ts');
const vars = await import('../src/gamenews/gameNewsVars.ts');
const scope = await import('../src/gamenews/gameNewsScope.ts');

const NOW = 1_950_000_000_000;
db.prepare('INSERT INTO servers (id, name, game, host, port, created_at) VALUES (1, ?, ?, ?, ?, ?)').run('Alpha', 'vrising', '10.0.0.1', 9876, NOW);
db.prepare("INSERT INTO game_news_targets (server_id, url, token, token_hash) VALUES (1, '', '', 'h1')").run();

const leave = (reason: string, at: number, by = '') => ({ kind: 'leave' as const, id: '7656119800000000' + String(at % 10), name: 'P' + at, reason, by, minutes: 5, at });

describe('the journal of joins and departures', () => {
  it('keeps what the plugin sent, with who removed the player', () => {
    conn.saveConnections(1, [{ kind: 'join', id: '1', name: 'Vamp', reason: '', by: '', minutes: -1, at: NOW }, leave('Kicked', NOW + 1, '.kick от Админ: спам')], NOW + 2);
    const rows = db.prepare('SELECT kind, reason, removed_by FROM game_connections ORDER BY id').all() as { kind: string; reason: string; removed_by: string }[];
    assert.deepEqual(rows.map((r) => r.kind), ['join', 'leave']);
    assert.equal(rows[1].removed_by, '.kick от Админ: спам');
  });

  it('alerts once when several players time out within a minute', () => {
    const t = NOW + 600_000;
    assert.equal(conn.saveConnections(1, [leave('Timeout', t), leave('Timeout', t + 1)], t + 2), false);
    assert.equal(conn.saveConnections(1, [leave('Timeout', t + 3)], t + 4), true);
    assert.equal(conn.saveConnections(1, [leave('Timeout', t + 5)], t + 6), false); // not again so soon
    assert.equal(conn.saveConnections(1, [leave('LeftGame', t + 7)], t + 8), false);
  });
});

describe('what the plugin could not patch', () => {
  it('is kept with the server and cleared when all is well again', () => {
    conn.savePluginProblems(1, 'ConsoleQueuePatch, Bad<name>', NOW);
    assert.equal((db.prepare('SELECT plugin_problems AS p FROM game_news_targets WHERE server_id = 1').get() as { p: string }).p, 'ConsoleQueuePatch, Badname');
    conn.savePluginProblems(1, '', NOW + 1);
    assert.equal((db.prepare('SELECT plugin_problems AS p FROM game_news_targets WHERE server_id = 1').get() as { p: string }).p, '');
  });
});

describe('the language of the plugin', () => {
  it('is Russian unless the server is set to English', () => {
    assert.equal(vars.langFor(1), 'ru');
    scope.writeScoped('gamenews_lang', 'en', 1);
    assert.equal(vars.langFor(1), 'en');
    assert.equal(vars.langFor(2), 'ru');
  });
});
