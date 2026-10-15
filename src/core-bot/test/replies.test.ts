import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLORS, bar10, cardReply, hexToInt, hoursText, panelBase, replyEmbed, type ProfileData } from '../src/replies.js';

const user = { displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/a.png' };
const profile = (over: Partial<ProfileData> = {}): ProfileData => ({
  found: true,
  username: 'neo',
  displayName: 'Neo',
  gameNick: 'NeoVR',
  rank: { id: 'r2', name: 'Охотник', hours: 12.5, color: '#aa3344', image: '/achievements/r2.png', next: { name: 'Граф', minHours: 30 }, progress: 0.4 },
  achievements: 3,
  achievementsTotal: 16,
  nickSeen: true,
  lastSeenAt: 1_700_000_000_000,
  profileUrl: 'https://gsm.example.com/profile',
  ...over,
});

test('small helpers', () => {
  assert.equal(bar10(0.4), '▰▰▰▰▱▱▱▱▱▱');
  assert.equal(bar10(2), '▰'.repeat(10));
  assert.equal(bar10(-1), '▱'.repeat(10));
  assert.equal(hoursText(12), '12');
  assert.equal(hoursText(12.54), '12,5');
  assert.equal(hexToInt('#ff0000'), 0xff0000);
  assert.equal(hexToInt('red'), COLORS.info);
});

test('the panel address is taken from both the old and the new profile links', () => {
  assert.equal(panelBase('https://gsm.example.com/#/profile'), 'https://gsm.example.com');
  assert.equal(panelBase('https://gsm.example.com/profile'), 'https://gsm.example.com');
  assert.equal(panelBase('https://gsm.example.com/sub/profile/'), 'https://gsm.example.com/sub');
  assert.equal(panelBase('javascript:alert(1)'), '');
});

test('a plain reply gets a status mark unless the title starts with an emoji', () => {
  assert.equal(replyEmbed('Готово', 'text', COLORS.ok).embeds[0].toJSON().title, '✅ Готово');
  assert.equal(replyEmbed('Ошибка', 'text', COLORS.bad).embeds[0].toJSON().title, '❌ Ошибка');
  assert.equal(replyEmbed('🩸 Привет', 'text', COLORS.ok).embeds[0].toJSON().title, '🩸 Привет');
  assert.equal(replyEmbed('t', 'd', COLORS.ok, 'ftp://x').embeds[0].toJSON().url, undefined);
  assert.equal(replyEmbed('t', 'd', COLORS.ok, 'https://x').embeds[0].toJSON().url, 'https://x');
});

test('the player card: rank, progress to the next rank, link buttons to the panel', () => {
  const r = cardReply(user, 'Neo', profile(), { title: 'Профиль: neo' });
  const e = r.embeds[0].toJSON();
  assert.equal(e.color, 0xaa3344);
  assert.equal(e.thumbnail?.url, 'https://gsm.example.com/achievements/r2.png');
  const names = (e.fields ?? []).map((f) => f.name);
  assert.ok(names.includes('🩸 Ранг V Rising'));
  assert.ok(names.includes('Следующий ранг: Граф'));
  assert.equal((e.fields ?? []).find((f) => f.name === '🏆 Достижений')?.value, '3 из 16');
  assert.match((e.fields ?? []).find((f) => f.name === '📡 Связь с сервером')!.value, /<t:1700000000:R>/);
  const buttons = r.components[0].toJSON().components as { url?: string }[];
  assert.deepEqual(buttons.map((b) => b.url), [
    'https://gsm.example.com/go/profile',
    'https://gsm.example.com/go/profile/player',
    'https://gsm.example.com/go/servers',
  ]);
});

test('the player card without a rank or a usable link', () => {
  const r = cardReply(user, 'Neo', profile({ rank: null, nickSeen: false, profileUrl: '' }), { title: 't', onboarding: true });
  const e = r.embeds[0].toJSON();
  assert.equal(e.thumbnail, undefined);
  assert.equal(r.components.length, 0);
  assert.match((e.fields ?? []).find((f) => f.name === '👣 Что дальше')!.value, /Зайдите на сервер V Rising под ником `NeoVR`/);
});
