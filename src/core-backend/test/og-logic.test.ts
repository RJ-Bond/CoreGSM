import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hslHex, monogramColor, monogramOf, ogLine } from '../src/ogLogic.ts';

describe('og logic', () => {
  it('the preview line', () => {
    assert.equal(ogLine({ online: 0, servers: 0, players: 0 }), 'Мониторинг игровых серверов');
    assert.equal(ogLine({ online: 3, servers: 4, players: 21 }), '21 игрок онлайн · 3 из 4 серверов в сети');
    assert.equal(ogLine({ online: 1, servers: 1, players: 2 }), '2 игрока онлайн · 1 из 1 сервера в сети');
  });
  it('monogram letters', () => {
    assert.equal(monogramOf('Space Engineers'), 'SE');
    assert.equal(monogramOf('Barotrauma'), 'BA');
    assert.equal(monogramOf('7 Days to Die'), '7D');
    assert.equal(monogramOf(''), '?');
  });
  it('a colour is stable and valid', () => {
    assert.equal(monogramColor('Barotrauma'), monogramColor('barotrauma'));
    assert.match(monogramColor('x'), /^#[0-9a-f]{6}$/);
    assert.equal(hslHex(0, 1, 0.5), '#ff0000');
  });
});
