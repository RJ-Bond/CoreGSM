import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cmpPlugin, hasFeature, missingFeatures } from '../src/gamenews/pluginFeatures.js';

describe('pluginFeatures', () => {
  it('compares versions by number, not by text', () => {
    assert.ok((cmpPlugin('0.18.2', '0.18.10') ?? 0) < 0);
    assert.equal(cmpPlugin('0.18.10', '0.18.10'), 0);
    assert.equal(cmpPlugin('x', '0.1'), null);
  });
  it('lists what an old plugin lacks', () => {
    const ids = missingFeatures('0.17.5').map((f) => f.id);
    assert.ok(ids.includes('metrics'));
    assert.ok(ids.includes('selfUpdate'));
    assert.ok(!ids.includes('palette'));
  });
  it('says nothing about a version that was never read', () => {
    assert.deepEqual(missingFeatures(''), []);
    assert.equal(hasFeature('', 'metrics'), true);
  });
  it('the newest plugin lacks nothing', () => assert.deepEqual(missingFeatures('0.18.12'), []));
});
