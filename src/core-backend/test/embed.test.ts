import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEmbed, type EmbedServer } from '../src/embed.ts';

const server = (over: Partial<EmbedServer> = {}): EmbedServer => ({
  name: '[RU] Test | PvE',
  game: 'vrising',
  address: 'v.example.ru:9876',
  hasStatus: true,
  online: true,
  players: 28,
  maxPlayers: 40,
  map: 'VRisingWorld',
  version: null,
  ping: 22,
  playerNames: Array.from({ length: 28 }, (_, i) => `Player${i}`),
  error: null,
  updatedAt: Date.UTC(2026, 9, 12, 14, 0, 0),
  ...over,
});

describe('discord embed', () => {
  const e = buildEmbed(server(), 100, 60, { baseUrl: 'https://panel.example.ru', serverId: 7, version: 'abcdef123456' });

  it('uses the game accent for an online server', () => {
    assert.equal(e.color, 0x8b5cf6);
  });

  it('links the title to the server page', () => {
    assert.equal(e.url, 'https://panel.example.ru/#/servers/7');
  });

  it('puts status, players and uptime in the first row and the address on its own row', () => {
    const f = e.fields!;
    assert.match(f[0]!.name, /Статус/);
    assert.match(f[1]!.name, /Игроки/);
    assert.match(f[2]!.name, /Аптайм/);
    assert.equal(f[3]!.inline, false);
    assert.match(f[3]!.name, /Адрес/);
  });

  it('draws a fill bar for the players', () => {
    const players = e.fields!.find((x) => /Игроки/.test(x.name))!;
    assert.match(players.value, /[🟩🟪🟨🟧🟥]+⬛*/u);
    assert.match(players.value, /28/);
  });

  it('links the players that do not fit to the panel', () => {
    const list = e.fields!.find((x) => /Сейчас в игре/.test(x.name))!;
    assert.match(list.value, /и ещё 10/);
    assert.match(list.value, /\(https:\/\/panel\.example\.ru\/#\/servers\/7\/players\)/);
  });

  it('pads the address row so embeds in one message have equal width, with no empty line under the title', () => {
    const addr = e.fields!.find((x) => /Адрес/.test(x.name))!;
    assert.ok(addr.value.includes('⠀'.repeat(10)));
    assert.equal(e.description, undefined);
  });

  it('stays within Discord limits', () => {
    for (const f of e.fields!) {
      assert.ok(f.name.length <= 256);
      assert.ok(f.value.length <= 1024);
    }
    assert.ok(e.fields!.length <= 25);
  });

  it('shows an offline server in red with the last-seen note', () => {
    const off = buildEmbed(server({ online: false, players: 0, playerNames: [], error: 'timeout' }), 80, 60, { lastOnlineAt: Date.UTC(2026, 9, 12, 13, 0, 0) });
    assert.equal(off.color, 0xf23f42);
    assert.ok(off.fields!.some((x) => /Последний раз онлайн/.test(x.name)));
  });
});
