/** The journal of the game plugin: notes of the plugin, the results of delivery, a streak of failures, the days it is kept. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-plog-'));
process.env.JWT_SECRET ||= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ||= 'i'.repeat(48);
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.NODE_ENV = 'test';
const { db, setSetting } = await import('../src/db.ts');
const P = await import('../src/gamenews/gameNewsPluginLog.ts');
const J = await import('../src/gamenews/gameNewsJournal.ts');
await import('../src/gamenews/gameNewsConnections.ts'); // the table of the joins and departures

const NOW = 1_800_000_000_000;
const addServer = (): number => Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('S', 'vrising', '127.0.0.1', 9876, ?)").run(NOW).lastInsertRowid);
const addMsg = (server: number, status: string, at: number, by = 'admin', error = ''): number =>
  Number(db.prepare("INSERT INTO game_news_log (server_id, server_name, text, ok, status, error, sent_by, sent_at, delivered_at) VALUES (?, 'S', 'Привет', 0, ?, ?, ?, ?, ?)").run(server, status, error, by, at, status === 'delivered' ? at + 1500 : null).lastInsertRowid);

describe('notes of the plugin', () => {
  it('keeps a known kind, turns an unknown one into «other», and drops an empty line', () => {
    const id = addServer();
    assert.equal(P.savePluginNotes(id, [{ kind: 'freeze', text: 'ЗАМИРАНИЕ 6.2 с', at: NOW }, { kind: 'weird', text: 'что-то', at: NOW }, { kind: 'mass', text: '   ', at: NOW }], NOW), 2);
    const rows = db.prepare('SELECT kind FROM game_plugin_log WHERE server_id = ? ORDER BY id').pluck().all(id);
    assert.deepEqual(rows, ['freeze', 'other']);
  });
  it('believes the time of the plugin unless its clock is far off', () => {
    const id = addServer();
    P.savePluginNotes(id, [{ kind: 'ping', text: 'a', at: NOW - 60_000 }, { kind: 'ping', text: 'b', at: NOW - 5 * 3_600_000 }], NOW);
    const ts = db.prepare('SELECT ts FROM game_plugin_log WHERE server_id = ? ORDER BY id').pluck().all(id);
    assert.deepEqual(ts, [NOW - 60_000, NOW]);
  });
});

describe('delivery', () => {
  it('records how many players saw a message, and marks one that could not be shown', () => {
    const id = addServer();
    const a = addMsg(id, 'delivered', NOW);
    const b = addMsg(id, 'delivered', NOW);
    const r = P.saveDelivery(id, [{ id: a, shown: 14 }, { id: b, shown: -1, reason: 'Мир сервера ещё не создан' }], NOW);
    assert.equal(r.updated, 2);
    const rows = db.prepare('SELECT status, shown, error FROM game_news_log WHERE id IN (?, ?) ORDER BY id').all(a, b);
    assert.deepEqual(rows, [{ status: 'delivered', shown: 14, error: '' }, { status: 'failed', shown: -1, error: 'Мир сервера ещё не создан' }]);
  });
  it('does not touch the message of another server', () => {
    const one = addServer();
    const two = addServer();
    const m = addMsg(one, 'delivered', NOW);
    assert.equal(P.saveDelivery(two, [{ id: m, shown: 5 }], NOW).updated, 0);
  });
  it('three messages in a row that did not reach the game make one alert, and not again at once', () => {
    const id = addServer();
    addMsg(id, 'failed', NOW - 3000);
    addMsg(id, 'expired', NOW - 2000);
    assert.equal(P.checkFailStreak(id, NOW), false, 'two are not enough');
    addMsg(id, 'failed', NOW - 1000);
    assert.equal(P.checkFailStreak(id, NOW), true);
    assert.equal(P.checkFailStreak(id, NOW + 60_000), false, 'one alert for a while');
  });
  it('a good message in between breaks the streak', () => {
    const id = addServer();
    addMsg(id, 'failed', NOW - 3000);
    addMsg(id, 'delivered', NOW - 2000);
    addMsg(id, 'failed', NOW - 1000);
    assert.equal(P.checkFailStreak(id, NOW + 3_600_000), false);
  });
});

describe('the journal', () => {
  it('has the notes, the delivery figures and the counts of the last day with the problems', () => {
    const id = addServer();
    addMsg(id, 'delivered', NOW - 60_000);
    db.prepare("UPDATE game_news_log SET shown = 12 WHERE server_id = ?").run(id);
    addMsg(id, 'failed', NOW - 50_000, 'авто: Тех.работы', 'не дошло');
    P.savePluginNotes(id, [{ kind: 'freeze', text: 'ЗАМИРАНИЕ', at: NOW - 40_000 }, { kind: 'save', text: 'СОХРАНЕНИЕ', at: NOW - 30_000 }], NOW);
    const list = J.journal({ kind: 'all', serverId: id, since: NOW - 3_600_000, until: NOW });
    assert.equal(list.length, 4);
    assert.equal(list.find((e) => e.kind === 'message')!.shown, 12);
    assert.equal(list.find((e) => e.kind === 'message')!.deliveredAt != null, true);
    const c = J.counts(id, NOW);
    assert.equal(c.all, 4);
    assert.equal(c.auto, 1);
    assert.equal(c.plugin, 2);
    assert.equal(c.problems, 2, 'a failed message and a freeze; a save is not a problem');
  });
  it('has a list of only the problems', () => {
    const id = addServer();
    addMsg(id, 'delivered', NOW - 60_000);
    addMsg(id, 'failed', NOW - 50_000);
    P.savePluginNotes(id, [{ kind: 'save', text: 'СОХРАНЕНИЕ', at: NOW - 40_000 }, { kind: 'mass', text: 'МАССОВЫЙ ВЫХОД', at: NOW - 30_000 }], NOW);
    const list = J.journal({ kind: 'problems', serverId: id, since: NOW - 3_600_000, until: NOW });
    assert.deepEqual(list.map((e) => e.status).sort(), ['failed', 'mass']);
  });
  it('gives what happened around a moment, with the players who left by timeout', () => {
    const id = addServer();
    addMsg(id, 'delivered', NOW - 120_000);
    P.savePluginNotes(id, [{ kind: 'freeze', text: 'ЗАМИРАНИЕ', at: NOW - 90_000 }], NOW);
    db.prepare("INSERT INTO game_connections (server_id, ts, kind, platform_id, nick, reason, removed_by, minutes) VALUES (?, ?, 'leave', '1', 'Bob', 'Timeout', '', 5)").run(id, NOW);
    addMsg(id, 'delivered', NOW - 3_600_000);
    const near = J.around(NOW, id);
    assert.deepEqual(near.map((e) => e.kind).sort(), ['conn', 'message', 'plugin']);
  });
});

describe('the days the journal is kept', () => {
  it('forgets old messages and notes, keeps a queued one, and uses 30 days unless told otherwise', () => {
    const id = addServer();
    const old = NOW - 40 * 86_400_000;
    addMsg(id, 'delivered', old);
    addMsg(id, 'queued', old);
    P.savePluginNotes(id, [{ kind: 'ping', text: 'старая', at: old }], old);
    addMsg(id, 'delivered', NOW - 86_400_000);
    assert.equal(P.journalDays(), 30);
    assert.equal(P.pruneJournal(30, NOW), 2, 'the old message and the old note');
    assert.equal(db.prepare("SELECT COUNT(*) FROM game_news_log WHERE server_id = ?").pluck().get(id), 2);
    setSetting('gamenews_journal_days', '7');
    assert.equal(P.journalDays(), 7);
    setSetting('gamenews_journal_days', '9999');
    assert.equal(P.journalDays(), 30, 'a value out of range is not used');
  });
});
