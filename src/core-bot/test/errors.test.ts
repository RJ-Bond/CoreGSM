import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliveryFailure, humanDiscordError, newNonce, retryAfterOf, retrySocket } from '../src/errors.js';

test('Discord error codes become texts a person can act on', () => {
  assert.match(humanDiscordError({ code: 50001, message: 'Missing Access' }), /нет доступа к каналу/);
  assert.match(humanDiscordError({ code: 50013 }), /Не хватает прав/);
  assert.match(humanDiscordError({ code: 'TokenInvalid' }), /Токен неверный/);
  assert.match(humanDiscordError(new Error('An invalid token was provided.')), /Токен неверный/);
  assert.match(humanDiscordError(new Error('connect ETIMEDOUT 1.2.3.4:443')), /Нет связи с Discord/);
  assert.match(humanDiscordError(new Error('SOCKS proxy rejected')), /прокси/);
});

test('an unknown error is passed through, cut to 200 characters', () => {
  assert.equal(humanDiscordError(new Error('something odd')), 'something odd');
  assert.equal(humanDiscordError(new Error('x'.repeat(500))).length, 200);
  assert.equal(humanDiscordError('plain string'), 'plain string');
});

test('rate limits: wait time from any of the fields discord.js uses, never under a second', () => {
  assert.equal(retryAfterOf(new Error('nope')), 0);
  assert.equal(retryAfterOf({ status: 500 }), 0);
  assert.equal(retryAfterOf({ status: 429, retryAfter: 2500 }), 2500);
  assert.equal(retryAfterOf({ status: 429, rawError: { retry_after: 3.2 } }), 3200);
  assert.equal(retryAfterOf({ timeToReset: 10 }), 1000);
  assert.equal(retryAfterOf({ code: 429 }), 5000);
});

test('delivery failures: closed DMs are final, missing permissions and rate limits are retried', () => {
  assert.deepEqual(deliveryFailure({ code: 50007 }), { text: 'пользователь закрыл ЛС', final: true });
  assert.deepEqual(deliveryFailure({ code: 10013 }), { text: 'пользователь не найден', final: true });
  assert.equal(deliveryFailure({ code: 50013 }).final, false);
  const limited = deliveryFailure({ status: 429, retryAfter: 4000 });
  assert.equal(limited.final, false);
  assert.equal(limited.retryAfterMs, 4000);
});

test('nonces are unique and fit the 25-character limit of Discord', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const n = newNonce();
    assert.ok(n.length > 0 && n.length <= 25, n);
    seen.add(n);
  }
  assert.equal(seen.size, 1000);
});

test('retrySocket retries a connection the proxy dropped, then succeeds', async () => {
  let calls = 0;
  const r = await retrySocket(async () => {
    if (++calls < 3) throw Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
    return 'ok';
  }, 3, 1);
  assert.equal(r, 'ok');
  assert.equal(calls, 3);
});

test('retrySocket recognises the socket error in the cause as well', async () => {
  let calls = 0;
  await retrySocket(async () => {
    if (++calls === 1) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return 1;
  }, 3, 1);
  assert.equal(calls, 2);
});

test('retrySocket does not retry an error from Discord itself (the request may have been executed)', async () => {
  let calls = 0;
  await assert.rejects(
    retrySocket(async () => {
      calls++;
      throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
    }, 3, 1),
    /Missing Permissions/,
  );
  assert.equal(calls, 1);
});

test('retrySocket gives up after the last try', async () => {
  let calls = 0;
  await assert.rejects(retrySocket(async () => { calls++; throw new Error('socket hang up'); }, 3, 1), /socket hang up/);
  assert.equal(calls, 3);
});
