import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DMX_ID, dmxStyle, dmxText, parseDmx } from '../src/dmxLogic.js';

test('dmx ids', () => {
  assert.deepEqual(parseDmx('dmx:ack:me'), { kind: 'ack', me: true });
  assert.deepEqual(parseDmx('dmx:ack:notme'), { kind: 'ack', me: false });
  assert.deepEqual(parseDmx('dmx:mute:42'), { kind: 'mute', serverId: 42 });
  for (const bad of ['dmx:', 'dmx:mute:x', 'dmx:ack:maybe', 'poll:1:2', 'dmx:mute:1234567890']) {
    assert.equal(parseDmx(bad), null);
    assert.ok(!DMX_ID.test(bad));
  }
});

test('dmx styles and texts', () => {
  assert.equal(dmxStyle('dmx:ack:me'), 3);
  assert.equal(dmxStyle('dmx:ack:notme'), 4);
  assert.equal(dmxStyle('dmx:mute:1'), 2);
  assert.match(dmxText(false).muted(24), /24 h/);
  assert.match(dmxText(true).muted(24), /24 ч/);
});
