import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newDeviceNotice } from '../src/security/newDeviceLogic.ts';

describe('new device notice', () => {
  it('names the device in the language of the account', () => {
    assert.match(newDeviceNotice('ru', 'Chrome · Windows').text, /Chrome · Windows/);
    assert.equal(newDeviceNotice('ru', 'x').title, 'Новый вход');
    assert.match(newDeviceNotice('en', 'Firefox · Linux').text, /Firefox · Linux/);
    assert.equal(newDeviceNotice('en', 'x').title, 'New sign-in');
  });
  it('an empty label and a very long one are both safe', () => {
    assert.match(newDeviceNotice('en', '  ').text, /unknown device/);
    assert.match(newDeviceNotice('ru', '  ').text, /неизвестное устройство/);
    assert.ok(newDeviceNotice('ru', 'x'.repeat(500)).text.length < 260);
  });
});
