/** Moderation from the game: the time of a ban, .kick / .ban / .warn / .unban, the short names of reasons, the block against coming back, the commands for the plugin. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-mod-'));
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ??= 'i'.repeat(48);
const { db, setSetting } = await import('../src/db.ts');
await import('../src/monitoring/restarts.ts'); // these make the tables that the lines of the chat read
await import('../src/monitoring/wipes.ts');
const scope = await import('../src/gamenews/gameNewsScope.ts');
const kick = await import('../src/gamenews/gameNewsKick.ts');
const mod = await import('../src/gamenews/gameNewsModLog.ts');
const jr = await import('../src/gamenews/gameNewsJournal.ts');

const NOW = 1_950_000_000_000;
setSetting('timezone', 'UTC');
for (const [id, name] of [[1, 'Alpha'], [2, 'Beta']] as const) {
  db.prepare('INSERT INTO servers (id, name, game, host, port, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, 'vrising', '10.0.0.' + id, 9876, NOW);
  db.prepare("INSERT INTO game_news_targets (server_id, url, token, token_hash) VALUES (?, '', '', ?)").run(id, `hash${id}`);
}

const P1 = '76561198000000011';
type Input = Parameters<typeof kick.runMod>[1];
const input = (o: Partial<Input>): Input => ({ action: 'kick', adminId: 'adm', adminName: 'Админ', targetId: P1, name: 'Vamp', targetIsAdmin: false, reason: '', ...o });

describe('the time of a ban', () => {
  it('reads minutes, hours, days and weeks in Latin and Cyrillic, and «for ever»', () => {
    assert.deepEqual(mod.parseBanTime('30m'), { seconds: 1800 });
    assert.deepEqual(mod.parseBanTime('2ч'), { seconds: 7200 });
    assert.deepEqual(mod.parseBanTime('7d'), { seconds: 604800 });
    assert.deepEqual(mod.parseBanTime('2н'), { seconds: 1209600 });
    assert.deepEqual(mod.parseBanTime('1d12h'), { seconds: 129600 });
    assert.deepEqual(mod.parseBanTime('3'), { seconds: 10800 });
    assert.deepEqual(mod.parseBanTime('перм'), { forever: true });
    assert.deepEqual(mod.parseBanTime('навсегда'), { forever: true });
  });
  it('refuses nonsense, too short and too long', () => {
    assert.deepEqual(mod.parseBanTime(''), { error: 'format' });
    assert.deepEqual(mod.parseBanTime('скоро'), { error: 'format' });
    assert.deepEqual(mod.parseBanTime('10s'), { error: 'format' });
    assert.deepEqual(mod.parseBanTime('0.5m'), { error: 'short' });
    assert.deepEqual(mod.parseBanTime('400d'), { error: 'long' });
  });
  it('says the length in Russian', () => {
    assert.equal(mod.formatSpan(7 * 86400), '7 дней');
    assert.equal(mod.formatSpan(86400 + 3 * 3600), '1 день 3 часа');
    assert.equal(mod.formatSpan(1800), '30 минут');
  });
});

describe('.kick, .ban, .warn, .unban', () => {
  it('turns the short name of a reason into its text', () => {
    assert.equal(kick.runMod(1, input({ reason: '1' }), NOW).ok, true);
    assert.equal(mod.recentMod({ player: 'Vamp', kind: 'kick' })[0].reason, 'Спам');
    assert.equal(kick.expandReason(kick.DEFAULT_KICK, 'своя причина'), 'своя причина');
  });

  it('bans for a time: the line, the private words, a ban in force that stops the player at the door', () => {
    const r = kick.runMod(1, input({ action: 'ban', time: '7d', reason: '3' }), NOW);
    assert.equal(r.ok, true);
    assert.equal(r.kick, true);
    assert.equal(r.line.includes('7 дней'), true);
    assert.equal(r.line.includes('Читы или использование багов'), true);
    assert.equal(r.notice.includes('Вы забанены до '), true);
    const block = kick.joinBlock(1, P1, NOW + 3600_000);
    assert.equal(block?.ban.kind, 'ban');
    assert.equal(block?.lines[0].includes('Вы забанены '), true);
    assert.match(block?.lines[0] ?? '', /<color=#5FD068>до \d{2}\.\d{2}\.\d{4} в \d{2}:\d{2}<\/color>/); // the date and the time are green
    assert.equal(kick.joinBlock(1, P1, NOW + 8 * 86_400_000), null); // the ban has run out
  });

  it('asks for a time and refuses a bad one', () => {
    assert.equal(kick.runMod(1, input({ action: 'ban', time: '' }), NOW).ok, false);
    assert.equal(kick.runMod(1, input({ action: 'ban', time: 'x' }), NOW).ok, false);
    assert.equal(kick.runMod(1, input({ action: 'ban', time: '400d' }), NOW).ok, false);
  });

  it('bans for ever and lets the player back with .unban', () => {
    const P2 = '76561198000000012';
    kick.runMod(1, input({ action: 'ban', time: 'перм', targetId: P2, name: 'Forever Guy' }), NOW);
    assert.equal(kick.joinBlock(1, P2, NOW + 400 * 86_400_000)?.lines[0].includes('навсегда'), true);
    assert.equal(mod.findBanByNick('forever')?.platform_id, P2);
    assert.equal(mod.removeBan(P2)?.nick, 'Forever Guy');
    assert.equal(kick.joinBlock(1, P2, NOW), null);
  });

  it('counts warnings and kicks at the limit, then starts again', () => {
    const P3 = '76561198000000013';
    scope.writeScoped('gamenews_kick', JSON.stringify({ warnTemplate: '* Предупреждение ({n} из {limit}). Причина: {reason}' }), 1);
    const w = (t: number) => kick.runMod(1, input({ action: 'warn', targetId: P3, name: 'Warned', reason: 'спам' }), NOW + t);
    const r1 = w(0);
    assert.equal(r1.kick, false);
    assert.equal(r1.line.includes('(</color><color=#FFCC33>1</color>'), true);
    assert.equal(w(1000).kick, false);
    assert.equal(w(2000).kick, true);
    assert.equal(mod.countMod(P3, 'warn'), 0);
    assert.equal(mod.recentMod({ player: 'Warned', kind: 'kick' })[0].admin, 'авто');
    assert.equal(w(3000).kick, false);
    scope.clearOverride('gamenews_kick', 1);
  });

  it('writes the lines of a ban, a warning and an unban like the game chat: «был забанен на …», «был предупреждён», «был разбанен»', () => {
    const s = kick.DEFAULT_KICK;
    const ban = kick.modLine(s, s.banTemplate, { name: 'Vamp', reason: 'спам', time: '1 час 30 минут' });
    assert.equal(ban, '<color=#FF5555>* Игрок </color><color=#5FD068>Vamp</color><color=#FF5555> был забанен на </color><color=#FFCC33>1 час 30 минут</color><color=#FF5555>. Причина: </color><color=#FFCC33>спам</color>');
    assert.equal(kick.modLine(s, s.warnTemplate, { name: 'Vamp', reason: 'спам' }), '<color=#FF5555>* Игрок </color><color=#5FD068>Vamp</color><color=#FF5555> был предупреждён. Причина: </color><color=#FFCC33>спам</color>');
    assert.equal(kick.modLine(s, s.unbanTemplate, { name: 'Vamp' }), '<color=#FF5555>* Игрок </color><color=#5FD068>Vamp</color><color=#FF5555> был разбанен.</color>');
    assert.equal(mod.formatSpan(5400), '1 час 30 минут');
  });

  it('does not count old warnings', () => {
    const P4 = '76561198000000014';
    kick.runMod(1, input({ action: 'warn', targetId: P4, name: 'Old', reason: 'x' }), NOW - 40 * 86_400_000);
    const r = kick.runMod(1, input({ action: 'warn', targetId: P4, name: 'Old', reason: 'x' }), NOW);
    assert.equal(r.kick, false);
    assert.equal(mod.countMod(P4, 'warn', NOW - 30 * 86_400_000), 1);
  });

  it('keeps administrators out of reach when it is asked to, and obeys a switch that is off', () => {
    assert.equal(kick.runMod(1, input({ targetIsAdmin: true }), NOW).ok, false);
    scope.writeScoped('gamenews_kick', JSON.stringify({ enabled: false }), 2);
    assert.equal(kick.runMod(2, input({}), NOW).ok, false);
    scope.clearOverride('gamenews_kick', 2);
  });

  it('blocks a quick return after a kick when it is set, only for the minutes set', () => {
    const P5 = '76561198000000015';
    scope.writeScoped('gamenews_kick', JSON.stringify({ rejoinBlockMin: 10 }), 1);
    kick.runMod(1, input({ targetId: P5, name: 'Back' }), NOW);
    const b = kick.joinBlock(1, P5, NOW + 60_000);
    assert.equal(b?.ban.kind, 'block');
    assert.equal(b?.lines[0].includes('9 минут'), true);
    assert.equal(kick.joinBlock(1, P5, NOW + 11 * 60_000), null);
    scope.clearOverride('gamenews_kick', 1);
  });

  it('a block does not shorten a ban that is in force', () => {
    const P6 = '76561198000000016';
    kick.runMod(1, input({ action: 'ban', time: '2d', targetId: P6, name: 'Long' }), NOW);
    scope.writeScoped('gamenews_kick', JSON.stringify({ rejoinBlockMin: 10 }), 1);
    kick.runMod(1, input({ targetId: P6, name: 'Long' }), NOW + 1000);
    assert.equal(kick.joinBlock(1, P6, NOW + 3600_000)?.ban.kind, 'ban');
    scope.clearOverride('gamenews_kick', 1);
  });

  it('tells the player in private only when it is on', () => {
    scope.writeScoped('gamenews_kick', JSON.stringify({ notifyPlayer: false }), 1);
    assert.equal(kick.runMod(1, input({ name: 'Quiet' }), NOW + 5000).notice, '');
    scope.clearOverride('gamenews_kick', 1);
    assert.equal(kick.runMod(1, input({ name: 'Loud' }), NOW + 9000).notice.includes('Вы были кикнуты'), true);
  });

  it('counts kicks, warnings and bans of a player and shows them in the journal', () => {
    const v = mod.topPlayers().find((t) => t.nick === 'Vamp');
    assert.equal((v?.kicks ?? 0) >= 1 && (v?.bans ?? 0) >= 1, true);
    const e = jr.journal({ kind: 'mod' }).find((x) => x.text === 'Vamp' && x.status === 'ban');
    assert.equal(e?.by, 'Админ');
  });
});

describe('the commands for the plugin (a kick from Discord)', () => {
  it('are taken once, reported on, and dropped when the plugin is late', () => {
    const id = mod.queueCommand(1, 'kick', { name: 'Vamp', reason: 'x', admin: 'Discord: A' }, NOW);
    assert.equal(mod.takeCommands(1, NOW + 1000).some((c) => c.id === id && c.payload.name === 'Vamp'), true);
    assert.equal(mod.takeCommands(1, NOW + 2000).some((c) => c.id === id), false);
    mod.finishCommand(1, id, true, 'Игрок кикнут');
    assert.equal(mod.commandState(id)?.state, 'done');
    const late = mod.queueCommand(2, 'kick', { name: 'x' }, NOW);
    mod.takeCommands(2, NOW + 120_000);
    assert.equal(mod.commandState(late)?.state, 'failed');
  });
});

describe('a switch for each command', () => {
  it('turns .ban and .warn off alone, and .kick keeps working', () => {
    scope.writeScoped('gamenews_kick', JSON.stringify({ banEnabled: false, warnEnabled: false }), 7);
    assert.equal(kick.runMod(7, input({ action: 'ban', time: '7d', reason: 'x' }), NOW).ok, false);
    assert.equal(kick.runMod(7, input({ action: 'warn', reason: 'x' }), NOW).ok, false);
    assert.equal(kick.runMod(7, input({ action: 'kick', reason: 'x', adminId: 'sw1' }), NOW).ok, true);
    assert.match(kick.runMod(7, input({ action: 'ban', time: '7d', reason: 'x' }), NOW).replies[0], /отключена/);
  });
});

describe('an administrator who touches himself', () => {
  it('is refused while the protection is on, and allowed when it is off', () => {
    scope.writeScoped('gamenews_kick', JSON.stringify({ protectAdmins: true }), 8);
    const me = input({ adminId: P1, targetId: P1, targetIsAdmin: true, reason: 'x' });
    const no = kick.runMod(8, me, NOW);
    assert.equal(no.ok, false);
    assert.match(no.replies[0], /не можете/);
    scope.writeScoped('gamenews_kick', JSON.stringify({ protectAdmins: false }), 8);
    assert.equal(kick.runMod(8, me, NOW).ok, true);
  });
});

describe('the answer to an administrator', () => {
  it('is not repeated when everybody reads the same line, and is given when nothing is announced', () => {
    scope.writeScoped('gamenews_kick', JSON.stringify({ announce: true }), 9);
    const loud = kick.runMod(9, input({ reason: 'x', adminId: 'a9' }), NOW);
    assert.equal(loud.ok, true);
    assert.deepEqual(loud.replies, []);
    assert.notEqual(loud.line, '');
    scope.writeScoped('gamenews_kick', JSON.stringify({ announce: false }), 9);
    const quiet = kick.runMod(9, input({ reason: 'x', adminId: 'a10' }), NOW);
    assert.equal(quiet.replies.length, 1);
  });
});

describe('how long a banned player may stay', () => {
  it('is 20 seconds by default and can be set from 0 to 120', () => {
    assert.equal(kick.getKick(11).banStaySec, 20);
    scope.writeScoped('gamenews_kick', JSON.stringify({ banStaySec: 45 }), 11);
    assert.equal(kick.getKick(11).banStaySec, 45);
    scope.writeScoped('gamenews_kick', JSON.stringify({ banStaySec: 9999 }), 11);
    assert.equal(kick.getKick(11).banStaySec, 120);
  });
});
