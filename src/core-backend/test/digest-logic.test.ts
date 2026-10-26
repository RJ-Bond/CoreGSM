import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changePct, dailyPeaks, sparkPoints, stripCommonPrefix, wrapName } from '../src/digestLogic.ts';

describe('digest logic', () => {
  it('takes the highest online of each day', () => {
    const dayOf = (ts: number) => (ts < 100 ? 'a' : ts < 200 ? 'b' : 'c');
    const rows = [{ ts: 1, players: 3 }, { ts: 50, players: 9 }, { ts: 120, players: 4 }, { ts: 999, players: 99 }];
    assert.deepEqual(dailyPeaks(rows, ['a', 'b', 'x'], dayOf), [9, 4, 0]);
  });
  it('compares with the week before', () => {
    assert.equal(changePct(15, 10), 50);
    assert.equal(changePct(5, 10), -50);
    assert.equal(changePct(5, 0), null);
  });
  it('lays out the line inside the box', () => {
    const p = sparkPoints([0, 5, 10], 100, 20);
    assert.deepEqual(p, [[0, 20], [50, 10], [100, 0]]);
    assert.deepEqual(sparkPoints([0, 0], 10, 10), [[0, 10], [10, 10]]);
  });
});

describe('digest names', () => {
  it('cuts the shared start so the difference shows', () => {
    assert.deepEqual(stripCommonPrefix(['[RU] Just-Skill.Ru | Standard', '[RU] Just-Skill.Ru | Hardcore']), ['Standard', 'Hardcore']);
  });
  it('leaves a single name and names without a shared start alone', () => {
    assert.deepEqual(stripCommonPrefix(['Alpha']), ['Alpha']);
    assert.deepEqual(stripCommonPrefix(['Alpha', 'Beta']), ['Alpha', 'Beta']);
  });
  it('does not cut when a name would be left too short', () => {
    assert.deepEqual(stripCommonPrefix(['Alpha on', 'Alpha one']), ['Alpha on', 'Alpha one']);
  });
  it('wraps by words onto two lines and marks a cut', () => {
    assert.deepEqual(wrapName('Standard PvE Europe', 12), ['Standard PvE', 'Europe']);
    assert.deepEqual(wrapName('Very long server name that never ends here', 12), ['Very long', 'server name…']);
    assert.deepEqual(wrapName('Short', 12), ['Short']);
  });
});
