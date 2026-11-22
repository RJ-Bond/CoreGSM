import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanActions, serverActions } from '../src/alerts/pushActions.ts';

describe('the buttons of a push notification', () => {
  it('keeps only addresses of the panel itself, at most two', () => {
    const out = cleanActions([
      { action: 'open', title: 'Открыть', url: '/servers/3' },
      { action: 'evil', title: 'Phish', url: 'https://example.com/x' },
      { action: 'proto', title: 'Phish', url: '//example.com/x' },
      { action: 'back', title: 'Phish', url: '/\\example.com' },
      { action: 'play', title: 'Играть', url: '/servers/3/connect' },
      { action: 'third', title: 'Третья', url: '/third' },
    ]);
    assert.deepEqual(out.map((a) => a.action), ['open', 'play']);
  });
  it('drops garbage, repeated ids and ids that are not letters', () => {
    assert.deepEqual(cleanActions('x'), []);
    assert.deepEqual(cleanActions([null, { action: 'A1', title: 't', url: '/x' }, { action: 'ok', title: '', url: '/x' }]), []);
    assert.equal(cleanActions([{ action: 'ok', title: 'a', url: '/a' }, { action: 'ok', title: 'b', url: '/b' }]).length, 1);
  });
  it('cuts a long title', () => {
    assert.equal(cleanActions([{ action: 'ok', title: 'x'.repeat(80), url: '/a' }])[0].title.length, 24);
  });
  it('the buttons of a server are its page and the way to connect', () => {
    assert.deepEqual(serverActions(7).map((a) => a.url), ['/servers/7', '/servers/7/connect']);
    assert.equal(cleanActions(serverActions(7)).length, 2);
  });
});
