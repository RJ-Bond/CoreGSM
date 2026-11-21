/** The messages of the panel (automatic announcements, the countdown of a restart, lines sent by hand) in the chat of Discord. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-announce-'));
process.env.JWT_SECRET ||= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ||= 'i'.repeat(48);
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.NODE_ENV = 'test';
await import('../src/db.ts');
const L = await import('../src/gamenews/gameNewsChatLogic.ts');
const C = await import('../src/gamenews/gameNewsChat.ts');
const { writeScoped } = await import('../src/gamenews/gameNewsScope.ts');
const { encryptSecret } = await import('../src/security/secrets.ts');

const ESC = String.fromCharCode(27);
const strip = (s: string) => s.split(ESC).join('').replace(/\[\d;\d+m|\[0m/g, '');
const NOW = new Date('2026-11-20T22:10:00').getTime();
// split, so that the check for committed secrets does not take this made-up address for a real one
const HOOK = 'https://discord.com/api/webhooks/123456789012345678/' + 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';
const configure = (extra: Record<string, unknown> = {}) => {
  writeScoped('gamenews_chat', JSON.stringify({ enabled: true, webhook: encryptSecret(HOOK), ...extra }));
  C.resetAnnounceMemory();
};

describe('where a message of the panel came from', () => {
  it('tells a rule, the countdown of a restart and a line written by hand; leaves out what came from Discord', () => {
    assert.deepEqual(L.announceSource('авто: Тех.работы'), { source: 'auto', label: 'Авто', who: 'Тех.работы' });
    assert.deepEqual(L.announceSource('авто: рестарт'), { source: 'restart', label: 'Рестарт', who: '' });
    assert.deepEqual(L.announceSource('RJ Bond'), { source: 'manual', label: 'Панель', who: 'RJ Bond' });
    assert.equal(L.announceSource('Discord: RJ'), null);
  });
});

describe('the line', () => {
  it('has the time, the mark, the name of the rule and the words without colour tags', () => {
    const c = L.DEFAULT_COLORS.announce;
    const line = strip(L.ansiAnnounceLine('Авто', 'Тех.работы', '<color=#FFCC33>* Завтра в 09:00 <b>тех работы</b></color>', c, '22:10'));
    assert.equal(line, '[22:10] * [Авто] Тех.работы: Завтра в 09:00 тех работы');
    assert.equal(L.ansiAnnounceLine('Авто', 'x', '<color=#fff></color>', c, '22:10'), '', 'no words: no line');
    assert.equal(L.formatAnnounceLine('Рестарт', '', 'Через 10 минут рестарт', '22:10'), '[22:10] **\* [Рестарт]**: Через 10 минут рестарт');
  });
});

describe('the settings', () => {
  it('show the messages of the panel by default: the announcements and the restarts, not the lines sent by hand', () => {
    const n = L.normalizeChat({});
    assert.equal(n.kinds.announce, true);
    assert.deepEqual(n.announce, { auto: true, restart: true, manual: false });
    assert.deepEqual(L.normalizeChat({ announce: { manual: true } }).announce, { auto: true, restart: true, manual: true });
    assert.deepEqual(L.normalizeChat({ kinds: { announce: false } }).kinds.announce, false);
  });
});

describe('posting to the channel', () => {
  it('queues an announcement, a restart line, and a line by hand only when it is switched on; never one from Discord', () => {
    configure();
    assert.equal(C.postAnnounceToDiscord(1, 'авто: Тех.работы', 'Завтра в 09:00', NOW), true);
    assert.equal(C.postAnnounceToDiscord(1, 'авто: рестарт', 'Рестарт через 10 минут', NOW), true);
    assert.equal(C.postAnnounceToDiscord(1, 'RJ Bond', 'Привет', NOW), false, 'by hand: off by default');
    assert.equal(C.postAnnounceToDiscord(1, 'Discord: RJ', 'Привет', NOW), false);
    const lines = C.pendingLines(0).map(strip);
    assert.ok(lines.some((l) => l.includes('* [Авто] Тех.работы: Завтра в 09:00')));
    assert.ok(lines.some((l) => l.includes('* [Рестарт]: Рестарт через 10 минут')));
  });
  it('follows the switches: the kind off, one source off, the chat off', () => {
    configure({ kinds: { announce: false } });
    assert.equal(C.postAnnounceToDiscord(1, 'авто: Другое', 'a', NOW), false);
    configure({ announce: { auto: false } });
    assert.equal(C.postAnnounceToDiscord(1, 'авто: Другое', 'b', NOW), false);
    assert.equal(C.postAnnounceToDiscord(1, 'авто: рестарт', 'c', NOW), true);
    configure({ enabled: false });
    writeScoped('gamenews_chat', JSON.stringify({ enabled: false, webhook: encryptSecret(HOOK) }));
    assert.equal(C.postAnnounceToDiscord(1, 'авто: Другое', 'd', NOW), false);
  });
  it('writes an announcement sent to several servers once', () => {
    configure();
    assert.equal(C.postAnnounceToDiscord(1, 'авто: Общее', 'Одно сообщение', NOW), true);
    const before = C.pendingLines(0).length;
    assert.equal(C.postAnnounceToDiscord(2, 'авто: Общее', 'Одно сообщение', NOW + 1000), false, 'the same words for the same channel a second later');
    assert.equal(C.pendingLines(0).length, before);
    assert.equal(C.postAnnounceToDiscord(2, 'авто: Общее', 'Одно сообщение', NOW + 5 * 60_000), true, 'later it is a new message');
  });
});
