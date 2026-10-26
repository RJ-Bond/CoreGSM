import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ByteLru, wantsWebp } from '../src/imageLogic.ts';

describe('wantsWebp', () => {
  it('reads the Accept header', () => {
    assert.equal(wantsWebp('image/avif,image/webp,image/apng,*/*;q=0.8'), true);
    assert.equal(wantsWebp('image/png,*/*;q=0.8'), false);
    assert.equal(wantsWebp('image/webp;q=0'), false);
    assert.equal(wantsWebp(undefined), false);
  });
});

describe('ByteLru', () => {
  it('forgets the oldest entries over the limit and keeps the one just read', () => {
    const c = new ByteLru<Buffer>(10);
    c.set('a', Buffer.alloc(4));
    c.set('b', Buffer.alloc(4));
    c.get('a');
    c.set('c', Buffer.alloc(4));
    assert.equal(c.get('b'), undefined);
    assert.ok(c.get('a'));
    assert.ok(c.get('c'));
    assert.ok(c.totalBytes <= 10);
  });
  it('does not store what is bigger than the whole cache', () => {
    const c = new ByteLru<Buffer>(5);
    c.set('x', Buffer.alloc(9));
    assert.equal(c.size, 0);
  });
});
