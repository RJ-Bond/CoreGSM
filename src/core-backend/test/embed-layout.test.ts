import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyLayout, parseLayout } from '../src/embedLayout.ts';
import type { DiscordEmbed } from '../src/embed.ts';

const e = (): DiscordEmbed => ({
  title: 'S', color: 1, description: '⚠️ x', author: { name: 'a' }, thumbnail: { url: 'u' }, image: { url: 'i' }, timestamp: 't', footer: { text: 'f' },
  fields: [
    { name: '📶 Статус', value: '🟢 **Онлайн** · 12 мс', inline: true },
    { name: '👥 Игроки', value: '**3**/20 (15%)\n🟩⬛⬛', inline: true },
    { name: '⏱️ Аптайм 24 ч', value: '99%', inline: true },
    { name: '📍 Адрес', value: '`a`', inline: false },
    { name: '🎮 Игра', value: 'CS2', inline: true },
    { name: '🗺️ Карта', value: 'de_dust2', inline: true },
    { name: '🧑‍🤝‍🧑 Сейчас в игре (3)', value: 'a · b' },
  ],
});

describe('parseLayout', () => {
  it('falls back to detailed', () => {
    assert.equal(parseLayout('compact'), 'compact');
    assert.equal(parseLayout('x'), 'detailed');
    assert.equal(parseLayout(undefined), 'detailed');
  });
});
describe('applyLayout', () => {
  it('detailed is untouched', () => assert.deepEqual(applyLayout(e(), 'detailed'), e()));
  it('compact keeps status, players and the list; drops author and image', () => {
    const r = applyLayout(e(), 'compact');
    assert.deepEqual(r.fields?.map((f) => f.name.slice(0, 2)), ['📶', '👥', '🧑']);
    assert.equal(r.author, undefined);
    assert.equal(r.image, undefined);
    assert.ok(r.thumbnail);
  });
  it('minimal is one description line', () => {
    const r = applyLayout(e(), 'minimal');
    assert.equal(r.fields, undefined);
    assert.equal(r.thumbnail, undefined);
    assert.equal(r.description, '🟢 **Онлайн** · 12 мс · 👥 **3**/20 (15%) · 🗺️ de_dust2\n⚠️ x');
    assert.equal(r.title, 'S');
  });
});
