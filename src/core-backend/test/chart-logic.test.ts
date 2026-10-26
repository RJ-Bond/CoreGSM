import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chartScale, playersBar } from '../src/chartLogic.ts';

describe('players bar', () => {
  it('a half-full server is all in the game colour', () => {
    assert.equal(playersBar(20, 40, '🟩'), '🟩🟩🟩⬛⬛⬛');
  });
  it('the last two squares turn amber and red as it fills up', () => {
    assert.equal(playersBar(35, 40, '🟩'), '🟩🟩🟩🟩🟧⬛');
  });
  it('a full server shows the whole gradient', () => {
    assert.equal(playersBar(40, 40, '🟪'), '🟪🟪🟪🟪🟧🟥');
  });
  it('one player always shows a square; no maximum, no bar', () => {
    assert.equal(playersBar(1, 100, '🟩'), '🟩⬛⬛⬛⬛⬛');
    assert.equal(playersBar(5, 0, '🟩'), '');
  });
});

describe('chart scale', () => {
  it('empty half hours are zero and the scale is at least one', () => {
    assert.deepEqual(chartScale([null, 0]), { values: [0, 0], max: 1 });
    assert.deepEqual(chartScale([2, null, 7]), { values: [2, 0, 7], max: 7 });
  });
});
