import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS } from '../src/commands.js';
import { HELP_CATEGORIES, HELP_COMMANDS, helpButtons, helpEmbed, serverButtons } from '../src/help.js';

test('/help and /servers are registered once', () => {
  for (const c of HELP_COMMANDS) assert.equal(COMMANDS.filter((x) => x.name === c.name).length, 1, c.name);
});

test('/help: the first screen lists every section, a section lists its commands', () => {
  const home = helpEmbed(null).toJSON();
  for (const c of HELP_CATEGORIES) assert.match(home.description!, new RegExp(c.label));
  const cat = helpEmbed('stat').toJSON();
  assert.match(cat.description!, /\/player/);
  assert.match(cat.description!, /\/top/);
  assert.equal(helpButtons('stat')[0]!.components.length, HELP_CATEGORIES.length);
});

test('every command of the bot is described in /help', () => {
  const text = HELP_CATEGORIES.flatMap((c) => c.lines.map((l) => l[0])).join(' ');
  for (const c of COMMANDS) if (c.name !== 'help') assert.ok(text.includes(`/${c.name}`), c.name);
});

test('/servers: five buttons per row, at most 20, the id is in the customId', () => {
  const servers = Array.from({ length: 30 }, (_, n) => ({ id: n + 1, name: `S${n + 1}`, game: 'rust', online: n % 2 === 0, players: 0, maxPlayers: 0, map: null }));
  const rows = serverButtons(servers);
  assert.equal(rows.length, 4);
  assert.equal(rows.reduce((a, r) => a + r.components.length, 0), 20);
  assert.equal((rows[0]!.components[0]!.toJSON() as { custom_id: string }).custom_id, 'srv:1');
});
