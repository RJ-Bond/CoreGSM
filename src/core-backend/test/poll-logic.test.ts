import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pollIsOpen, resultsText, tally, validatePoll } from '../src/communityPollLogic.ts';

const now = 1_000_000;
describe('validatePoll', () => {
  it('accepts a normal poll and trims', () => {
    const r = validatePoll({ question: '  Новая карта? ', options: [' Да ', 'Нет', ''] }, now);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.options, ['Да', 'Нет']);
  });
  it('rejects too few, too many, duplicate and long options', () => {
    assert.equal(validatePoll({ question: 'Вопрос?', options: ['Да'] }, now).ok, false);
    assert.equal(validatePoll({ question: 'Вопрос?', options: Array.from({ length: 11 }, (_, i) => `o${i}`) }, now).ok, false);
    assert.equal(validatePoll({ question: 'Вопрос?', options: ['Да', 'да'] }, now).ok, false);
    assert.equal(validatePoll({ question: 'Вопрос?', options: ['Да', 'x'.repeat(81)] }, now).ok, false);
  });
  it('rejects a short question and a closing time in the past', () => {
    assert.equal(validatePoll({ question: 'Ы', options: ['a', 'b'] }, now).ok, false);
    assert.equal(validatePoll({ question: 'Вопрос?', options: ['a', 'b'], closesAt: now - 1 }, now).ok, false);
    assert.equal(validatePoll({ question: 'Вопрос?', options: ['a', 'b'], closesAt: now + 1 }, now).ok, true);
  });
});
describe('pollIsOpen', () => {
  it('rules', () => {
    assert.equal(pollIsOpen({ closed: false, closesAt: null }, now), true);
    assert.equal(pollIsOpen({ closed: true, closesAt: null }, now), false);
    assert.equal(pollIsOpen({ closed: false, closesAt: now }, now), false);
  });
});
describe('tally and text', () => {
  it('percentages and total', () => {
    const t = tally([{ id: 1, text: 'A' }, { id: 2, text: 'B' }], new Map([[1, 3], [2, 1]]));
    assert.equal(t.total, 4);
    assert.deepEqual(t.rows.map((r) => r.pct), [75, 25]);
    assert.ok(resultsText(t.rows, t.total).includes('Всего голосов: **4**'));
  });
  it('no votes is zero percent', () => {
    const t = tally([{ id: 1, text: 'A' }], new Map());
    assert.equal(t.rows[0]!.pct, 0);
  });
});
