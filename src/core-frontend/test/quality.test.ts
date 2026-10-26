import { describe, expect, it } from 'vitest';
import { exportFileName } from '../src/components/server/helpers';
import { computeWizard } from '../src/components/DiscordWizard';
import { cleanIds, movePin, pushRecent, togglePin } from '../src/pages/adminShortcuts';
import { normalizeAppearance } from '../src/appearance';
import type { Binding, BotStatus, DiscordGuild } from '../src/api';

const bot = (over: Partial<BotStatus> = {}): BotStatus => ({ state: 'online', tag: 'Bot#1', clientId: '1', inviteUrl: 'https://discord.com/oauth2', error: null, updatedAt: 0, guildCount: 1, channelCount: 1, ...over });
const guild: DiscordGuild = { id: 'g1', name: 'G', channels: [{ id: '100000000000000001', name: 'general' }] };
const binding = (over: Partial<Binding> = {}): Binding => ({
  id: 1, serverId: 1, serverIds: [1], channelId: '100000000000000001', channelName: 'general', guildName: 'G', messageId: null, intervalSec: 60, enabled: true, style: 'embed', lastUpdate: null, lastError: null, ...over,
});

describe('history export file name', () => {
  it('is server-name-24h-YYYYMMDD.png', () => {
    expect(exportFileName('My Server #1', 24, Date.UTC(2026, 9, 13, 12))).toMatch(/^my-server-1-24h-2026101[34]\.png$/);
    expect(exportFileName('', 168, Date.UTC(2026, 0, 2, 12))).toMatch(/^server-7d-2026010[123]\.png$/);
    expect(exportFileName('Сервер Альфа', 720, Date.UTC(2026, 5, 15, 12))).toMatch(/^сервер-альфа-30d-20260615\.png$/);
  });
});

describe('Discord setup wizard', () => {
  const base = { tokenSet: true, bot: bot(), guilds: [guild], bindings: [] as Binding[], serverCount: 1 };
  it('starts at the token step', () => {
    const w = computeWizard({ ...base, tokenSet: false, bot: null, guilds: [] });
    expect(w.steps.map((s) => s.state)).toEqual(['current', 'blocked', 'blocked', 'blocked', 'blocked']);
    expect(w.complete).toBe(false);
  });
  it('asks to invite the bot when it is on no Discord server', () => {
    const w = computeWizard({ ...base, bot: bot({ guildCount: 0 }), guilds: [] });
    expect(w.steps[2].state).toBe('current');
    expect(w.steps[1].state).toBe('done');
  });
  it('asks for the first binding once the bot sees a channel', () => {
    const w = computeWizard(base);
    expect(w.steps[3].state).toBe('current');
  });
  it('reports missing channel permissions', () => {
    const g: DiscordGuild = { ...guild, channels: [{ ...guild.channels[0], missing: ['Прикрепление файлов'] }] };
    const w = computeWizard({ ...base, guilds: [g], bindings: [binding()] });
    expect(w.steps[3].state).toBe('current');
    expect(w.steps[3].problem).toContain('Прикрепление файлов');
  });
  it('waits for the first message, then completes', () => {
    expect(computeWizard({ ...base, bindings: [binding()] }).steps[4].state).toBe('current');
    const done = computeWizard({ ...base, bindings: [binding({ messageId: '5', lastUpdate: 1 })] });
    expect(done.complete).toBe(true);
    expect(done.steps.every((s) => s.state === 'done')).toBe(true);
  });
});

describe('admin shortcuts', () => {
  const valid = ['servers', 'discord', 'news', 'users'];
  it('cleans stored ids', () => {
    expect(cleanIds(['news', 'x', 'news', 5, 'users'], valid, 5)).toEqual(['news', 'users']);
    expect(cleanIds('nope', valid, 5)).toEqual([]);
    expect(cleanIds(valid, valid, 2)).toEqual(['servers', 'discord']);
  });
  it('keeps the five most recent, newest first, without duplicates', () => {
    let r: string[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'c']) r = pushRecent(r, id);
    expect(r).toEqual(['c', 'f', 'e', 'd', 'b']);
  });
  it('pins up to six', () => {
    let pins: string[] = [];
    for (const id of ['1', '2', '3', '4', '5', '6']) pins = togglePin(pins, id).pins;
    expect(togglePin(pins, '7')).toEqual({ pins, full: true });
    expect(togglePin(pins, '3').pins).toEqual(['1', '2', '4', '5', '6']);
  });
  it('reorders pins', () => {
    const pins = ['a', 'b', 'c'];
    expect(movePin(pins, 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(movePin(pins, 'a', 9)).toEqual(['b', 'c', 'a']);
    expect(movePin(pins, 'a', -3)).toEqual(['a', 'b', 'c']);
    expect(movePin(pins, 'x', 0)).toBe(pins);
  });
});

describe('appearance', () => {
  it('normalises stored values', () => {
    expect(normalizeAppearance(null)).toEqual({ reduceMotion: false, largeText: false, highContrast: false, liteData: false });
    expect(normalizeAppearance({ reduceMotion: true, largeText: 'yes' })).toEqual({ reduceMotion: true, largeText: false, highContrast: false, liteData: false });
  });
});
