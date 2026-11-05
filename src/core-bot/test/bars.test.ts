import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameSquare, playersBar } from '../src/bars.js';

test('colour by game', () => {
  assert.equal(gameSquare('vrising'), '🟪');
  assert.equal(gameSquare('icarus'), '🟨');
  assert.equal(gameSquare('rust'), '🟩');
  assert.equal(gameSquare(undefined), '🟩');
});

test('fill bar like the monitoring card', () => {
  assert.equal(playersBar(0, 40, 'vrising'), '⬛⬛⬛⬛⬛⬛');
  assert.equal(playersBar(1, 40, 'vrising'), '🟪⬛⬛⬛⬛⬛', 'a server with players shows at least one square');
  assert.equal(playersBar(10, 40, 'vrising'), '🟪🟪⬛⬛⬛⬛');
  assert.equal(playersBar(20, 40, 'rust'), '🟩🟩🟩⬛⬛⬛');
  assert.equal(playersBar(40, 40, 'rust'), '🟩🟩🟩🟩🟧🟥');
  assert.equal(playersBar(99, 40, 'rust'), '🟩🟩🟩🟩🟧🟥', 'never above the maximum');
  assert.equal(playersBar(5, 0, 'rust'), '');
});
