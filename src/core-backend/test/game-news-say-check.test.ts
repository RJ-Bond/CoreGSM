/** «Проверить запись из Discord»: the list of what may stop a line on its way from the chat channel to the game. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-saycheck-'));
process.env.JWT_SECRET ||= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ||= 'i'.repeat(48);
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.NODE_ENV = 'test';
await import('../src/db.ts');
const S = await import('../src/gamenews/gameNewsSayCheck.ts');
const { bot } = await import('../src/discord/botState.ts');

const NOW = 1_800_000_000_000;
const byId = (id: string) => S.sayChecks(NOW).checks.find((c) => c.id === id)!;

describe('the checks', () => {
  it('say that no channel is listened to when nothing is set up, and what to do', () => {
    const c = byId('channel');
    assert.equal(c.ok, false);
    assert.match(c.fix ?? '', /webhook/);
  });
  it('turn the state of the bot into a plain line: an error with its cause, not started', () => {
    bot.status = { state: 'error', tag: null, clientId: null, error: 'Включите Intents', commands: null, updatedAt: NOW };
    assert.equal(byId('bot').ok, false);
    assert.match(byId('bot').text, /Включите Intents/);
    assert.match(byId('bot').fix ?? '', /Message Content Intent/);
    bot.status = { state: 'online', tag: 'Bot#1', clientId: '1', error: null, commands: 3, updatedAt: NOW };
    assert.equal(byId('bot').ok, true);
  });
  it('cannot say whether the bot sees the channel before the bot reported its channels', () => {
    assert.equal(byId('visible').ok, null);
  });
  it('lists the last attempts, newest first, and counts those of the last ten minutes', () => {
    S.resetSayAttempts();
    assert.equal(byId('attempts').ok, null, 'nothing came from the bot');
    S.noteSayAttempt({ ts: NOW - 60_000, name: 'RJ', status: 'denied', why: 'не администратор' });
    S.noteSayAttempt({ ts: NOW - 30_000, name: 'RJ', status: 'sent', why: 'отправлено' });
    const r = S.sayChecks(NOW);
    assert.equal(r.attempts[0]!.status, 'sent');
    assert.equal(byId('attempts').ok, true);
    assert.match(byId('attempts').text, /2/);
    assert.equal(S.sayChecks(NOW + 20 * 60_000).checks.find((c) => c.id === 'attempts')!.ok, null, 'older than ten minutes: nothing recent');
  });
});
