import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrangeEmbeds, embedChars, messageServerIds, newsContent, playerButtons, type RawEmbed } from '../src/messages.js';

const server = (n: number, extra: Partial<RawEmbed> = {}): RawEmbed => ({
  title: `Server ${n}`,
  url: `https://gsm.example.com/servers/${n}`,
  author: { name: 'CoreGSM' },
  footer: { text: 'updated' },
  timestamp: '2026-01-01T00:00:00.000Z',
  fields: [{ name: 'Players', value: '3/10' }],
  ...extra,
});

test('a message shows the main server first, without duplicates, at most 10', () => {
  assert.deepEqual(messageServerIds({ serverId: 5, serverIds: [1, 5, 2] }), [5, 1, 2]);
  assert.deepEqual(messageServerIds({ serverId: 1 }), [1]);
  assert.equal(messageServerIds({ serverId: 0, serverIds: Array.from({ length: 30 }, (_, i) => i + 1) }).length, 10);
});

test('embedChars counts what Discord counts towards the 6000 limit', () => {
  assert.equal(embedChars({ title: 'ab', description: 'cde', footer: { text: 'f' }, author: { name: 'gh' }, fields: [{ name: 'i', value: 'jk' }] }), 11);
  assert.equal(embedChars({}), 0);
});

test('several servers: brand line on the first embed, footer and time on the last one', () => {
  const raws = [server(1), server(2), server(3)];
  arrangeEmbeds(raws);
  assert.ok(raws[0].author);
  assert.equal(raws[1].author, undefined);
  assert.equal(raws[2].author, undefined);
  assert.equal(raws[0].footer, undefined);
  assert.equal(raws[0].timestamp, undefined);
  assert.ok(raws[2].footer);
  assert.ok(raws[2].timestamp);
});

test('one server is left as the backend built it', () => {
  const raws = [server(1)];
  arrangeEmbeds(raws);
  assert.deepEqual(raws[0], server(1));
});

test('over the character limit the player lists are cut, from the last server backwards', () => {
  const fields = Array.from({ length: 12 }, (_, i) => ({ name: `f${i}`, value: 'x'.repeat(200) }));
  const raws = [server(1, { fields: [...fields] }), server(2, { fields: [...fields] }), server(3, { fields: [...fields] })];
  arrangeEmbeds(raws);
  assert.equal(raws[2].fields!.length, 6);
  assert.equal(raws[1].fields!.length, 6);
  assert.ok(raws.reduce((n, r) => n + embedChars(r), 0) <= 5800);
});

test('players buttons: one per server (up to 5) with the server name, only for http(s) links', () => {
  assert.deepEqual(playerButtons([server(1)]), [{ label: '👥 Все игроки на сайте', url: 'https://gsm.example.com/servers/1/players' }]);
  const many = playerButtons([1, 2, 3, 4, 5, 6].map((n) => server(n)));
  assert.equal(many.length, 5);
  assert.equal(many[1].label, '👥 Server 2');
  assert.deepEqual(playerButtons([server(1, { url: 'javascript:alert(1)' }), server(2, { url: undefined })]), []);
  assert.equal(playerButtons([server(1, { url: 'https://h/servers/1/' })])[0].url, 'https://h/servers/1/players');
});

test('news text: the mention goes in front once', () => {
  assert.equal(newsContent({ content: 'Hello', mention: 'none' }), 'Hello');
  assert.equal(newsContent({ content: 'Hello', mention: 'everyone' }), '@everyone\nHello');
  assert.equal(newsContent({ content: 'Hi @here all', mention: 'here' }), 'Hi @here all');
  assert.equal(newsContent({ content: '  ', mention: 'here' }), '@here');
  assert.equal(newsContent({ content: '', mention: 'none' }), '');
});
