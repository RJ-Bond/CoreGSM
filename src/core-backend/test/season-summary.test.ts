import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { seasonSummary } from '../src/profile/seasonLogic.ts';

describe('season summary for Discord', () => {
  it('lists the podium with medals and the length of the season', () => {
    const m = seasonSummary('Лето', 0, 30 * 86_400_000, [{ name: 'Ann', hours: 12.34 }, { name: 'Bob', hours: 8 }], 'Осень');
    const d = String(m.embed.description);
    assert.match(d, /🥇 \*\*Ann\*\* · 12\.3 ч/);
    assert.match(d, /🥈 \*\*Bob\*\* · 8 ч/);
    assert.doesNotMatch(d, /🥉/);
    assert.match(d, /30 дн/);
    assert.match(String(m.embed.title), /Лето/);
  });
  it('says so when nobody played, and escapes markdown in a nick', () => {
    assert.match(String(seasonSummary('X', 0, 1, [], 'Y').embed.description), /никто не играл/);
    assert.ok(String(seasonSummary('X', 0, 1, [{ name: 'a*b_c', hours: 1 }], 'Y').embed.description).includes(['**a', '*b', '_c**'].join(String.fromCharCode(92))));
  });
});
