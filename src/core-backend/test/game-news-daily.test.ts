/** The daily summary of the joins and departures: the numbers of a day, the text, once a day after the hour. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-daily-'));
process.env.JWT_SECRET ||= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ||= 'i'.repeat(48);
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.NODE_ENV = 'test';
const { db, getSetting, setSetting } = await import('../src/db.ts');
await import('../src/gamenews/gameNewsConnections.ts');
await import('../src/gamenews/gameNewsPluginLog.ts');
const D = await import('../src/gamenews/gameNewsDaily.ts');

const ZONE = 'Europe/Moscow';
// 2026-11-20 00:00 MSK = 2026-11-19 21:00 UTC
const DAY0 = Date.UTC(2026, 10, 19, 21);
const H = 3_600_000;
const row = (ts: number, kind: string, id: string, nick: string, reason = '', removed_by = '') => ({ ts, kind, platform_id: id, nick, reason, removed_by });

describe('the numbers of a day', () => {
  it('sorts the departures, the timeouts by hour and player, outages of several at once, the notes', () => {
    const t = DAY0 + 17 * H; // 17:00 MSK
    const rows = [
      row(DAY0 + H, 'join', '1', 'Amo'), row(DAY0 + H, 'join', '2', 'Rus'), row(DAY0 + H, 'join', '3', 'Kek'),
      row(DAY0 + 2 * H, 'leave', '1', 'Amo', 'LeftGame k_ESteamNetworkingConnectionState_ClosedByPeer'),
      row(DAY0 + 8 * H, 'leave', '1', 'Amo', 'Timeout k_ESteamNetworkingConnectionState_ProblemDetectedLocally'),
      row(t, 'leave', '1', 'Amo', 'Timeout x'), row(t + 2000, 'leave', '2', 'Rus', 'Timeout x'), row(t + 5000, 'leave', '3', 'Kek', 'Timeout x'),
      row(DAY0 + 18 * H, 'leave', '4', 'Bad', 'LeftGame', 'бан'),
      row(DAY0 + 19 * H, 'leave', '5', 'Stm', 'AuthenticationError'),
    ];
    const s = D.summarize(rows, [{ kind: 'other', text: 'СЕТЬ СЕРВЕРА: интернет недоступен 9 с' }, { kind: 'net', text: 'ПРОЦЕСС СТОЯЛ 6.1 с' }, { kind: 'freeze', text: 'ЗАМИРАНИЕ' }], ZONE);
    assert.equal(s.joins, 3);
    assert.equal(s.players, 5);
    assert.equal(s.leaves, 7);
    assert.deepEqual([s.quit, s.timeouts, s.steam, s.removed, s.other], [1, 4, 1, 1, 0]);
    assert.equal(s.timeoutPlayers, 3);
    assert.deepEqual(s.bursts, [3]);
    assert.equal(s.hours[17], 3);
    assert.equal(s.hours[8], 1);
    assert.deepEqual(s.repeat, [{ nick: 'Amo', n: 2 }]);
    assert.deepEqual(s.notes, { net: 1, stood: 1, freeze: 1, mass: 0 });
    const text = D.dailyText(s, { timeouts: 7, leaves: 70, days: 7 });
    assert.match(text, /⏱️ таймаут — \*\*4\*\* \(57%, 3 игрока\)/);
    assert.match(text, /`17:00` ×3 · `08:00` ×1/);
    assert.match(text, /Обрывы сразу у нескольких игроков: 1\*\* \(3 игрока\)/);
    assert.match(text, /🔺 больше обычного/);
    assert.equal(D.dailyColor(s), 0xed4245, 'several at once: red');
    assert.match(D.hourBars(s.hours), /^```\n········▃········█······\n/);
    assert.match(text, /Amo ×2/);
    assert.match(text, /в среднем 1,0 таймаута в день \(10% выходов\)/);
    assert.match(text, /обрывов сети сервера 1, пауз процесса\/ВМ 1, замираний 1/);
  });
  it('single timeouts far apart are not an outage of several', () => {
    const s = D.summarize([row(DAY0, 'leave', '1', 'a', 'Timeout'), row(DAY0 + 60_000, 'leave', '2', 'b', 'Timeout'), row(DAY0 + 120_000, 'leave', '3', 'c', 'Timeout')], [], ZONE);
    assert.deepEqual(s.bursts, []);
    assert.match(D.dailyText(s, { timeouts: 0, leaves: 0, days: 0 }), /таймауты одиночные/);
  });
});

describe('once a day', () => {
  it('after the hour, the day before, once; nothing without the service channel', () => {
    const ins = db.prepare('INSERT INTO game_connections (server_id, ts, kind, platform_id, nick, reason, removed_by, minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    ins.run(1, DAY0 + 10 * H, 'join', '1', 'Amo', '', '', -1);
    ins.run(1, DAY0 + 11 * H, 'leave', '1', 'Amo', 'Timeout x', '', 60);
    assert.equal(D.buildDaily('2026-11-20', ZONE).length, 1);
    assert.equal(D.buildDaily('2026-11-21', ZONE).length, 0, 'an empty day is not told');
    setSetting('timezone', ZONE);
    const before = DAY0 + 24 * H + 8 * H; // 21.11 08:00 MSK
    assert.equal(D.checkDaily(before), 0, 'before the hour');
    assert.notEqual(getSetting('gn_daily_last'), '2026-11-21');
    D.checkDaily(before + 2 * H);
    assert.equal(getSetting('gn_daily_last'), '2026-11-21', 'the day is marked even when there is no channel to tell');
    setSetting('gn_daily_summary', '0');
    setSetting('gn_daily_last', '');
    assert.equal(D.checkDaily(before + 2 * H), 0, 'switched off');
    assert.equal(D.dayTitle('2026-11-20'), '20 ноября');
  });
});
