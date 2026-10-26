import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { needsAgreement, nextRulesVersion } from '../src/rulesLogic.ts';

describe('nextRulesVersion', () => {
  it('the first text is version 1', () => assert.equal(nextRulesVersion(null, ' Be kind '), 1));
  it('a changed text is the next version', () => assert.equal(nextRulesVersion({ version: 3, text: 'a' }, 'b'), 4));
  it('the same text (ignoring spaces) or an empty one records nothing', () => {
    assert.equal(nextRulesVersion({ version: 3, text: 'a' }, ' a\n'), null);
    assert.equal(nextRulesVersion({ version: 3, text: 'a' }, '  '), null);
    assert.equal(nextRulesVersion(null, ''), null);
  });
});
describe('needsAgreement', () => {
  it('rules', () => {
    assert.equal(needsAgreement(null, null), false);
    assert.equal(needsAgreement(2, null), true);
    assert.equal(needsAgreement(2, 1), true);
    assert.equal(needsAgreement(2, 2), false);
  });
});
