import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS } from '../src/commands.js';
import { HELP_CATEGORIES, HELP_CMD_NAMES, HELP_COMMANDS, commandEmbed, helpComponents, helpEmbed, helpView, serverButtons } from '../src/help.js';
import { cmdInfo, type Lang } from '../src/helpData.js';

const ctx = (lang: Lang = 'ru', admin = true) => ({ lang, admin, live: null, me: null, supportUrl: null });
const live = { players: 16, up: 4, total: 4 };

test('/help and /servers are registered once', () => {
  for (const c of HELP_COMMANDS) assert.equal(COMMANDS.filter((x) => x.name === c.name).length, 1, c.name);
});

test('/help: the first screen lists the sections, a section lists its commands', () => {
  const home = helpEmbed(null, ctx()).toJSON();
  for (const c of HELP_CATEGORIES.filter((x) => x.id !== 'modclr')) assert.match(home.description!, new RegExp(c.label.ru));
  const cat = helpEmbed('stat', ctx()).toJSON();
  assert.match(cat.description!, /\/player/);
  assert.match(cat.description!, /\/top/);
  assert.notEqual(helpEmbed('mod', ctx()).toJSON().color, helpEmbed('srv', ctx()).toJSON().color, 'a colour for every section');
});

test('every command of the bot is described in /help', () => {
  const text = HELP_CMD_NAMES.join(' ');
  for (const c of COMMANDS) if (c.name !== 'help' && !(c as { type?: number }).type) assert.ok(text.includes(`/${c.name}`), c.name);
});

test('/help: a player does not see the moderation, an administrator does', () => {
  const player = helpView(null, ctx('ru', false));
  assert.doesNotMatch(player.embeds[0]!.toJSON().description!, /Модерация/);
  const menu = (v: ReturnType<typeof helpView>) => JSON.stringify(v.components[0]!.toJSON());
  assert.doesNotMatch(menu(player), /"value":"mod"/);
  assert.match(menu(helpView(null, ctx())), /"value":"mod"/);
  // asking for a section the person may not see gives the first screen
  assert.equal(helpView('mod', ctx('ru', false)).embeds[0]!.toJSON().title, '📖 Что умеет бот');
});

test('/help: the menu marks the open section, the buttons fit a row', () => {
  const rows = helpComponents('srv', ctx());
  assert.equal(rows.length, 2);
  const menu = rows[0]!.toJSON() as { components: { options: { value: string; default?: boolean }[] }[] };
  assert.equal(menu.components[0]!.options.find((o) => o.default)?.value, 'srv');
  assert.ok(menu.components[0]!.options.length <= 25);
  const ids = helpComponents('home', ctx())[1]!.components.map((c) => (c.toJSON() as { custom_id?: string }).custom_id);
  assert.ok(ids.includes('help:act:online') && ids.includes('help:act:top') && ids.includes('help:close'));
  assert.ok(helpComponents('home', { ...ctx(), supportUrl: 'https://example.com/help' })[1]!.components.length <= 5);
});

test('/help: live numbers, the line about the person, the English version', () => {
  assert.match(helpEmbed(null, { ...ctx(), live }).toJSON().description!, /Сейчас играют \*\*16\*\*/);
  assert.match(helpEmbed('srv', { ...ctx(), live }).toJSON().description!, /Сейчас играют/);
  assert.doesNotMatch(helpEmbed('play', { ...ctx(), live }).toJSON().description!, /Сейчас играют/);
  const me = { found: true, gameNick: 'Bob', rank: null };
  assert.match(helpEmbed(null, { ...ctx(), me }).toJSON().description!, /Bob/);
  assert.equal(helpEmbed(null, ctx('en')).toJSON().title, '📖 What the bot can do');
  assert.match(helpEmbed('srv', ctx('en')).toJSON().description!, /a list of servers/);
});

test('/help: the memo about /clear and «What is new»', () => {
  const e = helpEmbed('modclr', ctx()).toJSON();
  assert.ok((e.fields ?? []).length >= 5);
  for (const f of e.fields ?? []) assert.ok(f.value.length <= 1024, f.name);
  assert.match(helpEmbed('modclr', ctx('en')).toJSON().fields![0]!.name, /Examples/);
  const news = helpEmbed('news', { ...ctx(), news: { version: '1.1.21', date: null, items: ['one', 'two'] } }).toJSON();
  assert.match(news.title!, /v1\.1\.21/);
  assert.match(news.description!, /• one\n• two/);
  assert.match(helpEmbed('news', ctx()).toJSON().description!, /Не удалось/);
});

test('/help command:ban: usage, examples and requirements', () => {
  const e = commandEmbed(cmdInfo('ban')!, 'en').toJSON();
  assert.equal(e.title, '🛡️ /ban');
  assert.deepEqual(e.fields!.map((f) => f.name).slice(0, 3), ['Usage', 'Examples', 'Requirements']);
  assert.match(e.fields![2]!.value, /Ban Members/);
});

test('/servers: five buttons per row, at most 20, the id is in the customId', () => {
  const servers = Array.from({ length: 30 }, (_, n) => ({ id: n + 1, name: `S${n + 1}`, game: 'rust', online: n % 2 === 0, players: 0, maxPlayers: 0, map: null }));
  const rows = serverButtons(servers);
  assert.equal(rows.length, 4);
  assert.equal(rows.reduce((a, r) => a + r.components.length, 0), 20);
  assert.equal((rows[0]!.components[0]!.toJSON() as { custom_id: string }).custom_id, 'srv:1');
});
