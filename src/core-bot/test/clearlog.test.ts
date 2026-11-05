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
