import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// http.ts has no side effects on import (no database), so it can be loaded directly
const { wrap } = await import('../src/http.ts');

const fakeReq = {} as never;
const fakeRes = {} as never;

describe('wrap (async route handlers)', () => {
  it('passes a rejected promise to next() instead of leaving it unhandled', async () => {
    const boom = new Error('disk full');
    let got: unknown = null;
    wrap(async () => {
      throw boom;
    })(fakeReq, fakeRes, (e?: unknown) => {
      got = e;
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(got, boom);
  });

  it('passes a synchronous throw to next() too', () => {
    const boom = new Error('sync');
    let got: unknown = null;
    wrap(() => {
      throw boom;
    })(fakeReq, fakeRes, (e?: unknown) => {
      got = e;
    });
    assert.equal(got, boom);
  });

  it('does not call next() when the handler succeeds', async () => {
    let called = false;
    let ran = false;
    wrap(async () => {
      ran = true;
    })(fakeReq, fakeRes, () => {
      called = true;
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(ran, true);
    assert.equal(called, false);
  });
});
