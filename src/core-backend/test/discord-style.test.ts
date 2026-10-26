import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStyle, styleAlertEmbed } from '../src/discordStyleLogic.ts';

const base = { brandName: 'Club', brandColor: '#112233', accent: '', logo: true, footer: '', baseUrl: 'https://p.example' };
describe('resolveStyle', () => {
  it('the accent is the brand colour unless one is set', () => {
    assert.equal(resolveStyle(base).accent, 0x112233);
    assert.equal(resolveStyle({ ...base, accent: '#ff0000' }).accent, 0xff0000);
    assert.equal(resolveStyle({ ...base, accent: 'red' }).accent, 0x112233);
  });
  it('the logo needs a public address and a switch; the footer defaults to the brand', () => {
    assert.equal(resolveStyle(base).logoUrl, 'https://p.example/logo-128.png');
    assert.equal(resolveStyle({ ...base, baseUrl: null }).logoUrl, null);
    assert.equal(resolveStyle({ ...base, logo: false }).logoUrl, null);
    assert.equal(resolveStyle(base).footer, 'Club');
    assert.equal(resolveStyle({ ...base, footer: ' My Club ' }).footer, 'My Club');
  });
});
describe('styleAlertEmbed', () => {
  const s = resolveStyle(base);
  it('replaces the old footer and the neutral colour', () => {
    const r = styleAlertEmbed({ title: 't', color: 0x5865f2, footer: { text: 'CoreGSM · оповещение' } }, 'test', s);
    assert.equal(r.color, 0x112233);
    assert.deepEqual(r.footer, { text: 'Club · оповещение', icon_url: 'https://p.example/logo-128.png' });
  });
  it('keeps warning colours and an own footer', () => {
    const r = styleAlertEmbed({ color: 0xf23f42, footer: { text: 'Вышла 26.10.2026' } }, 'update', s);
    assert.equal(r.color, 0xf23f42);
    assert.deepEqual(r.footer, { text: 'Вышла 26.10.2026' });
  });
  it('digest and poll get their own label', () => {
    assert.equal(styleAlertEmbed({}, 'digest', s).footer?.text, 'Club · итоги недели');
    assert.equal(styleAlertEmbed({}, 'poll', s).footer?.text, 'Club · голосование');
  });
});
