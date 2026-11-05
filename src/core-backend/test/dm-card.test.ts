import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BYPASS_QUIET, COLORS, digestCard, digestLine, inQuiet, localHour, newDeviceCard, newsCard, normQuiet, trend, weeklyCard, weeklyDue, quietEnd, resetCard, seenCard, serverCard, stamp, type Ctx } from '../src/alerts/dmCard.js';

const ru: Ctx = { lang: 'ru', base: 'https://panel.example', brand: 'CoreGSM' };
const en: Ctx = { ...ru, lang: 'en' };

test('stamp: Discord timestamp in seconds', () => assert.equal(stamp(1_700_000_000_500), '<t:1700000000:R>'));

test('server card: colour by meaning, fields and buttons', () => {
  const ev = (kind: 'free_slot' | 'back_online' | 'went_down') => ({ kind, ts: 1_700_000_000_000, players: 3, max: 10 });
  const down = serverCard(ru, { serverId: 7, name: 'Vrising', address: '1.2.3.4:9876', events: [ev('went_down')] });
  assert.equal(down.embed.color, COLORS.bad);
  assert.match(down.embed.title, /недоступен/);
  assert.ok(down.embed.fields?.some((f) => f.name === 'Игроков' && f.value === '3/10'));
  assert.deepEqual(down.buttons.map((b) => b.customId), ['dmx:mute:7']);
  assert.ok(down.actions.some((a) => a.url === 'https://panel.example/servers/7'));
  assert.ok(down.actions.some((a) => a.url === 'https://panel.example/profile'), 'settings button');
  assert.equal(serverCard(ru, { serverId: 7, name: 'V', address: '', events: [ev('back_online')] }).embed.color, COLORS.good);
  assert.equal(serverCard(ru, { serverId: 7, name: 'V', address: '', events: [ev('free_slot')] }).embed.color, COLORS.info);
});

test('server card: several events become one card, the last decides the colour', () => {
  const c = serverCard(en, { serverId: 1, name: 'S', address: '', events: [{ kind: 'went_down', ts: 1000, players: 0, max: 5 }, { kind: 'back_online', ts: 2000, players: 0, max: 5 }] });
  assert.match(c.embed.title, /2 events/);
  assert.equal(c.embed.color, COLORS.good);
  assert.equal(c.embed.description?.split('\n').length, 2);
});

test('language and no links without a public address', () => {
  const c = newDeviceCard({ ...en, base: '' }, { device: '', ts: 1000 });
  assert.match(c.embed.title, /New sign-in/);
  assert.equal(c.actions.length, 0);
  assert.deepEqual(c.buttons.map((b) => b.customId), ['dmx:ack:me', 'dmx:ack:notme']);
  assert.equal(c.embed.fields?.[0]?.value, 'an unknown device');
});

test('reset card has a button instead of the link in the text', () => {
  const c = resetCard(ru, { username: 'anna', url: 'https://panel.example/#/reset/abc', expiresAt: 5000 });
  assert.ok(!JSON.stringify(c.embed).includes('/reset/'));
  assert.equal(c.actions[0]?.url, 'https://panel.example/#/reset/abc');
});

test('news and seen cards', () => {
  const n = newsCard(ru, { title: 'Вайп', category: 'Новости', text: 'x'.repeat(500), imageUrl: 'https://i/x.png', url: 'https://panel.example/news/3', ts: 1 });
  assert.ok((n.embed.description ?? '').length <= 280);
  assert.equal(n.embed.image?.url, 'https://i/x.png');
  assert.equal(n.actions[0]?.label, '📖 Читать на сайте');
  assert.equal(seenCard(en, { server: 'S', nick: 'Bob', ts: 1 }).embed.color, COLORS.seen);
});

test('quiet hours across midnight', () => {
  const q = { from: 23, to: 8 };
  assert.ok(inQuiet(23, q) && inQuiet(2, q) && inQuiet(7, q));
  assert.ok(!inQuiet(8, q) && !inQuiet(12, q) && !inQuiet(22, q));
  assert.ok(!inQuiet(5, { from: -1, to: -1 }));
  assert.deepEqual(normQuiet({ from: 3, to: 3 }), { from: -1, to: -1 });
  assert.deepEqual(normQuiet({ from: 23, to: 8 }), q);
});

test('quiet end follows the time zone of the person', () => {
  const t = Date.UTC(2026, 0, 10, 22, 30); // 22:30 UTC = 01:30 in Moscow (UTC+3)
  assert.equal(localHour(t, 'Europe/Moscow'), 1);
  const end = quietEnd(t, { from: 23, to: 8 }, 'Europe/Moscow');
  assert.equal(new Date(end).toISOString(), '2026-01-11T05:00:00.000Z'); // 08:00 Moscow
  assert.equal(quietEnd(t, { from: 23, to: 8 }, 'UTC'), t, 'not quiet at 22:30 UTC');
});

test('security cards are never held back; digest is capped', () => {
  for (const k of ['newdevice', 'reset', 'changed']) assert.ok(BYPASS_QUIET.has(k));
  assert.ok(!BYPASS_QUIET.has('news'));
  const lines = Array.from({ length: 20 }, (_, i) => digestLine(`item ${i}`, 1000));
  const d = digestCard(ru, { lines, since: 1000 });
  assert.equal(d.embed.description?.split('\n').length, 16);
  assert.match(d.embed.description ?? '', /ещё 5/);
});

test('weekly summary: card and schedule', () => {
  const w = { from: 0, to: 7 * 86_400_000, peak: 24, peakPrev: 20, peakAt: 1000, newPlayers: 9, activePlayers: 31, newAccounts: 3, warns: 4, bans: 1, kicks: 2, mutes: 0, reports: 5 };
  const c = weeklyCard(ru, w);
  assert.match(c.embed.title, /Итоги недели/);
  assert.match(c.embed.fields![0]!.value, /\*\*24\*\* · ▲ 20%/);
  assert.match(c.embed.fields!.find((f) => f.name.includes('Наказаний'))!.value, /^7/);
  assert.equal(trend(0, 0), '=');
  assert.equal(trend(5, 10), '▼ 50%');
  // 2026-11-02 is a Monday; 09:30 Moscow = 06:30 UTC
  const mon = Date.UTC(2026, 10, 2, 6, 30);
  assert.ok(weeklyDue(mon, 0, 'Europe/Moscow'));
  assert.ok(!weeklyDue(Date.UTC(2026, 10, 2, 5, 0), 0, 'Europe/Moscow'), 'before 09:00');
  assert.ok(!weeklyDue(Date.UTC(2026, 10, 3, 9, 0), 0, 'Europe/Moscow'), 'Tuesday');
  assert.ok(!weeklyDue(mon, mon - 3600_000, 'Europe/Moscow'), 'already sent today');
  assert.ok(BYPASS_QUIET.has('weekly'));
});
