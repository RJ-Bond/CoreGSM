import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draw, joinProblem, validateGiveaway } from '../src/community/giveawayLogic.js';

test('conditions', () => {
  assert.equal(joinProblem({ roleId: '', minHours: 0 }, { roles: [], hours: null }), null);
  assert.equal(joinProblem({ roleId: '5', minHours: 0 }, { roles: ['4'], hours: null }), 'role');
  assert.equal(joinProblem({ roleId: '5', minHours: 0 }, { roles: ['5'], hours: null }), null);
  assert.equal(joinProblem({ roleId: '', minHours: 10 }, { roles: [], hours: null }), 'unlinked');
  assert.equal(joinProblem({ roleId: '', minHours: 10 }, { roles: [], hours: 9.9 }), 'hours');
  assert.equal(joinProblem({ roleId: '', minHours: 10 }, { roles: [], hours: 10 }), null);
});

test('draw: distinct winners, skips earlier ones, never more than the pool', () => {
  const rnd = (n: number) => n - 1;
  const w = draw(['a', 'b', 'c', 'd', 'a'], 2, rnd);
  assert.equal(w.length, 2);
  assert.equal(new Set(w).size, 2);
  assert.deepEqual(draw(['a', 'b'], 5, rnd).sort(), ['a', 'b']);
  assert.deepEqual(draw(['a', 'b', 'c'], 3, rnd, ['b']).sort(), ['a', 'c']);
  assert.deepEqual(draw([], 1, rnd), []);
});

test('draw is uniform enough', () => {
  const seen: Record<string, number> = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 3000; i++) seen[draw(['a', 'b', 'c'], 1, (n) => Math.floor(Math.random() * n))[0]!]!++;
  for (const k of Object.keys(seen)) assert.ok(seen[k]! > 800, k);
});

test('validation', () => {
  assert.equal(validateGiveaway({ prize: 'Скин', winners: 1, hours: 24 }), null);
  assert.ok(validateGiveaway({ prize: 'x', winners: 1, hours: 24 }));
  assert.ok(validateGiveaway({ prize: 'Скин', winners: 0, hours: 24 }));
  assert.ok(validateGiveaway({ prize: 'Скин', winners: 1, hours: 0 }));
  assert.ok(validateGiveaway({ prize: 'Скин', winners: 21, hours: 24 }));
});
