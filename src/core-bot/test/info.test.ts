import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INFO_COMMANDS, onlineEmbed, playerEmbed, topEmbed } from '../src/info.js';
import { RENAME_GAP_MS, renameDue } from '../src/sync.js';
import { COMMANDS } from '../src/commands.js';

test('the info commands are registered with the rest', () => {
  for (const c of INFO_COMMANDS) assert.ok(COMMANDS.some((x) => x.name === c.name), c.name);
  assert.equal(new Set(COMMANDS.map((c) => c.name)).size, COMMANDS.length);
});

test('/online: total in the title, online servers with a fill bar, offline ones marked', () => {
  const e = onlineEmbed({
    players: 25,
    url: 'https://panel.example',
    servers: [
      { id: 1, name: 'Alpha', game: 'rust', online: true, players: 25, maxPlayers: 50, map: 'Procedural' },
      { id: 2, name: 'Beta', game: 'rust', online: false, players: 0, maxPlayers: 0, map: null },
    ],
  }).toJSON();
  assert.match(e.title!, /25 игроков/);
  assert.match(e.description!, /🟢 \*\*Alpha\*\* — 25\/50 ████░░░░ · Procedural/);
  assert.match(e.description!, /🔴 \*\*Beta\*\* — не в сети/);
  assert.equal(e.url, 'https://panel.example');
  assert.match(e.footer!.text, /1 из 2/);
});

test('/player: stats as fields, a streak gets the flame, a non-http link is dropped', () => {
  const e = playerEmbed({ name: 'Viktor', online: false, lastSeen: 1_700_000_000_000, hours: 12.5, visits: 7, days: 5, streak: 4, usualHour: 21, servers: [{ name: 'Alpha', hours: 10 }], url: 'javascript:x' }).toJSON();
  assert.equal(e.title, '👤 Viktor');
  assert.match(e.description!, /<t:1700000000:R>/);
  assert.match(e.description!, /вечером, около 21:00/);
  assert.deepEqual(e.fields!.slice(0, 3).map((f) => f.value), ['12,5', '7', '🔥 4 дня']);
  assert.equal(e.url, undefined);
});

test('/top: medals for the first three', () => {
  const e = topEmbed({ period: 'month', url: null, top: [1, 2, 3, 4].map((n) => ({ name: `P${n}`, hours: 10 - n, servers: 1 })) }).toJSON();
  assert.match(e.title!, /месяц/);
  const lines = e.description!.split('\n');
  assert.ok(lines[0].startsWith('🥇') && lines[2].startsWith('🥉'));
  assert.match(lines[3], /` 4` \*\*P4\*\*/);
});

test('counters: renamed only when the name changed and not more often than every 5 minutes', () => {
  const now = 10 * RENAME_GAP_MS;
  assert.equal(renameDue('Онлайн: 5', 'Онлайн: 5', undefined, now), false);
  assert.equal(renameDue('Онлайн: 5', 'Онлайн: 6', undefined, now), true);
  assert.equal(renameDue('Онлайн: 5', 'Онлайн: 6', now - RENAME_GAP_MS + 1, now), false);
  assert.equal(renameDue('Онлайн: 5', 'Онлайн: 6', now - RENAME_GAP_MS, now), true);
});
