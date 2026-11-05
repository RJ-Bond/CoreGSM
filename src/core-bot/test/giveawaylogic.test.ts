import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayEdit, withParticipants } from '../src/giveawayLogic.js';

test('participants line is added, then replaced', () => {
  const a = withParticipants('Нажмите кнопку.\n🏆 Победителей: **1**', 3);
  assert.equal(a, 'Нажмите кнопку.\n🏆 Победителей: **1**\n👥 Участников: **3**');
  assert.equal(withParticipants(a, 12), 'Нажмите кнопку.\n🏆 Победителей: **1**\n👥 Участников: **12**');
});

test('edit pause', () => {
  const m = new Map<string, number>();
  assert.equal(mayEdit(m, 'x', 1000), true);
  assert.equal(mayEdit(m, 'x', 2000), false);
  assert.equal(mayEdit(m, 'y', 2000), true);
  assert.equal(mayEdit(m, 'x', 6000), true);
});
