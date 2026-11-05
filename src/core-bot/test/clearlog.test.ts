import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logDescription, logTitle } from '../src/clearLogic.js';

const base = { modId: '1', channelId: '2', deleted: 41, elapsedMs: 162_000, pinned: 0, old: 0, count: 0, target: '', keepPinned: true, includeOld: true, reason: '' };

test('clear log: title by outcome', () => {
  assert.match(logTitle('ok'), /очищен/);
  assert.match(logTitle('stopped'), /остановлена/);
  assert.match(logTitle('error'), /не удалась/);
});

test('clear log: compact lines', () => {
  const d = logDescription(base);
  assert.match(d, /<@1>.*<#2>/);
  assert.match(d, /41 сообщ.*2 мин 42 с/);
  assert.match(d, /весь чат, включая старше 14 дней/);
  assert.equal(d.split('\n').length, 3);
  const d2 = logDescription({ ...base, pinned: 3, old: 5, reason: 'спам', target: '9', count: 50, keepPinned: false, includeOld: false });
  assert.match(d2, /последние 50, только <@9>, включая закреплённые/);
  assert.match(d2, /закреплённых оставлено: \*\*3\*\*/);
  assert.match(d2, /5\+/);
  assert.match(d2, /спам/);
});

import { noteCleaning, WEEK_MS } from '../src/clearLogic.js';
import { cardBody } from '../src/punishLogic.js';

test('clear log: weekly counter', () => {
  const m = new Map<string, number[]>();
  assert.equal(noteCleaning(m, 'a', 1000), 1);
  assert.equal(noteCleaning(m, 'a', 2000), 2);
  assert.equal(noteCleaning(m, 'b', 2000), 1);
  assert.equal(noteCleaning(m, 'a', 2000 + WEEK_MS - 1), 2, 'the first one is over a week old by now');
  assert.match(logDescription({ ...base, weekN: 3 }), /🔁 3-я очистка/);
  assert.doesNotMatch(logDescription({ ...base, weekN: 1 }), /🔁/);
});

test('mod card body: compact lines', () => {
  const b = cardBody({ done: 'заблокирован', targetId: '5', targetName: 'vasya', modId: '7', reason: 'спам', chips: ['🧹 7 дней', '✉️ ЛС доставлено'] });
  assert.equal(b, '<@5> заблокирован.\n\n👤 **vasya**  ·  🛡️ <@7>\n📝 спам\n🧹 7 дней  ·  ✉️ ЛС доставлено');
  assert.match(cardBody({ done: 'x', targetId: '5', targetName: 'v', modId: '7', reason: '', bar: '▰▱', chips: [] }), /x\.\n▰▱\n\n.*\n📝 причина не указана$/);
});
