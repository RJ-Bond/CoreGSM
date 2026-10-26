import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_TEMPLATE, parseGameFile } from '../src/gameFileLogic.ts';

describe('parseGameFile', () => {
  it('the template is valid', () => {
    const r = parseGameFile(GAME_TEMPLATE);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.profile.accent, 0x5a4bd1);
      assert.equal(r.profile.connect.steam, 'steam://connect/{address}');
    }
  });
  it('the minimum is id and label', () => {
    const r = parseGameFile({ id: 'abc', label: 'ABC' });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.profile.fields, { map: true, mode: false, version: true, players: true });
  });
  it('lists every problem', () => {
    const r = parseGameFile({ id: 'Bad Id', label: '', defaultPort: 70000, colour: 1, fields: { map: 'yes', x: true }, connect: { steam: 'http://x' }, accent: 'red' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.errors.length, 8);
  });
  it('rejects a non-object', () => {
    assert.equal(parseGameFile([]).ok, false);
    assert.equal(parseGameFile('x').ok, false);
  });
});
