import { describe, expect, it } from 'vitest';
import { badgeText, normalizeKinds, notificationHref, toggleKind } from '../src/notifications';
import { applyConnectTemplates, connectGuide, fillConnectTemplate, isSafeConnectHref } from '../src/connectGuides';
import { dismissNewDevice, isNewDeviceDismissed, newDeviceKey, unreadableSecrets } from '../src/security';
import { nextPort, shownFields } from '../src/gameProfiles';

describe('bell badge', () => {
  it('hides zero, shows the number and caps at 99+', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(-4)).toBe('');
    expect(badgeText(undefined)).toBe('');
    expect(badgeText(7)).toBe('7');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
    expect(badgeText(1234)).toBe('99+');
  });
  it('links a notification to its server', () => {
    expect(notificationHref({ serverId: 12 })).toBe('#/servers/12');
    expect(notificationHref({ serverId: null })).toBeNull();
  });
});

describe('subscription kinds', () => {
  it('toggles a kind on and off, keeping the canonical order and no duplicates', () => {
    expect(toggleKind([], 'went_down')).toEqual(['went_down']);
    expect(toggleKind(['went_down'], 'free_slot')).toEqual(['free_slot', 'went_down']);
    expect(toggleKind(['free_slot', 'went_down'], 'free_slot')).toEqual(['went_down']);
    expect(toggleKind(['free_slot'], 'free_slot')).toEqual([]);
  });
  it('drops unknown kinds', () => {
    expect(normalizeKinds(['back_online', 'nope', 'back_online'])).toEqual(['back_online']);
    expect(normalizeKinds('free_slot')).toEqual([]);
  });
});

describe('connect templates', () => {
  it('fills address, host and port', () => {
    expect(fillConnectTemplate('steam://connect/{address}', 'play.example.com:27016')).toBe('steam://connect/play.example.com:27016');
    expect(fillConnectTemplate('connect {host}:{port}', 'play.example.com:27016')).toBe('connect play.example.com:27016');
    expect(fillConnectTemplate('{host}:{port}', 'play.example.com', 7777)).toBe('play.example.com:7777');
  });
  it('overrides the built-in guide and keeps it without templates', () => {
    const g = connectGuide('rust', 'h:28015');
    expect(applyConnectTemplates(g, null, 'h:28015')).toBe(g);
    const a = applyConnectTemplates(g, { steam: 'steam://run/252490//+connect%20{address}', command: 'client.connect {host}:{port}' }, 'h:28015');
    expect(a.link?.href).toBe('steam://run/252490//+connect%20h:28015');
    expect(a.copy.find((c) => /команд/i.test(c.label))?.value).toBe('client.connect h:28015');
    expect(a.copy.filter((c) => /команд/i.test(c.label))).toHaveLength(1);
  });
  it('adds a command to a guide that had none and refuses script links', () => {
    const g = connectGuide('minecraft', 'h:25565');
    const a = applyConnectTemplates(g, { command: '/join {address}', steam: 'javascript://alert(1)' }, 'h:25565');
    expect(a.copy[1].value).toBe('/join h:25565');
    expect(a.link).toBeUndefined();
    expect(isSafeConnectHref('steam://connect/1.2.3.4')).toBe(true);
    expect(isSafeConnectHref('javascript:alert(1)')).toBe(false);
  });
});

describe('port prefill', () => {
  const base = { hasHost: true, prevDefault: 25565, nextDefault: 28015 };
  it('follows the game while the port is the previous default or empty', () => {
    expect(nextPort({ ...base, current: 25565, touched: false })).toBe(28015);
    expect(nextPort({ ...base, current: 0, touched: true })).toBe(28015);
    expect(nextPort({ ...base, current: 30000, touched: false, hasHost: false })).toBe(28015);
  });
  it('never replaces a port the user chose', () => {
    expect(nextPort({ ...base, current: 25565, touched: true })).toBe(25565);
    expect(nextPort({ ...base, current: 30000, touched: false })).toBe(30000);
    expect(nextPort({ ...base, current: 25565, touched: false, nextDefault: undefined })).toBe(25565);
  });
  it('lists the details the panel shows', () => {
    expect(shownFields({ map: true, mode: false, version: 1, players: true })).toEqual(['map', 'version', 'players']);
    expect(shownFields(undefined)).toEqual([]);
  });
});

describe('new device banner', () => {
  it('keys the dismissal by the sign-in time', () => {
    expect(newDeviceKey(1700000000000)).toBe('coregsm_newdev_1700000000000');
    expect(newDeviceKey(1700000000000)).not.toBe(newDeviceKey(1700000000001));
  });
  it('does not throw without storage', () => {
    expect(typeof isNewDeviceDismissed(5)).toBe('boolean');
    expect(() => dismissNewDevice(5)).not.toThrow();
  });
});

describe('unreadable secrets', () => {
  it('names known secrets, keeps unknown ids and removes duplicates', () => {
    const r = unreadableSecrets(['discord_token', 'smtp_password', 'discord_token', 'mystery']);
    expect(r.map((x) => x.id)).toEqual(['discord_token', 'smtp_password', 'mystery']);
    expect(r[2].label).toBe('mystery');
    expect(r[0].label.length).toBeGreaterThan(0);
    expect(unreadableSecrets(undefined)).toEqual([]);
  });
});
