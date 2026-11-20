/** The alerts about the plugins themselves: one that went silent, one that is old; each told once. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-palerts-'));
process.env.JWT_SECRET ||= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ||= 'i'.repeat(48);
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.NODE_ENV = 'test';
const { db, setSetting } = await import('../src/db.ts');
const A = await import('../src/gamenews/gameNewsPluginAlerts.ts');

const NOW = 1_800_000_000_000;
const row = (p: Partial<{ server_id: number; last_seen: number; plugin_version: string; token_hash: string }> = {}) => ({ server_id: 1, last_seen: NOW - 20 * 60_000, plugin_version: '0.18.3', token_hash: 'x', ...p });
const opts = { silentMin: 10, outdated: true, latest: '0.18.11' };

describe('versions', () => {
  it('compares dotted numbers; an unknown version is not older', () => {
    assert.equal(A.isOlder('0.18.3', '0.18.11'), true);
    assert.equal(A.isOlder('0.18.11', '0.18.11'), false);
    assert.equal(A.isOlder('0.19.0', '0.18.11'), false);
    assert.equal(A.isOlder('', '0.18.11'), false);
    assert.equal(A.isOlder('abc', '0.18.11'), false);
  });
});

describe('what is due', () => {
  it('a silent plugin: after the minutes, never for a server that has not talked yet, not for one that is gone for good', () => {
    A.resetTold();
    assert.deepEqual(A.pluginAlertsDue([row()], NOW, opts).map((a) => a.kind), ['silent']);
    assert.equal(A.pluginAlertsDue([row({ last_seen: NOW - 5 * 60_000 })], NOW, opts).length, 0, 'five minutes is not enough');
    assert.equal(A.pluginAlertsDue([row({ last_seen: 0 })], NOW, opts).length, 0, 'it has not talked yet');
    assert.equal(A.pluginAlertsDue([row({ last_seen: NOW - 30 * 86_400_000 })], NOW, opts).length, 0, 'gone for good');
    assert.equal(A.pluginAlertsDue([row({ token_hash: '' })], NOW, opts).length, 0, 'no token');
    assert.equal(A.pluginAlertsDue([row()], NOW, { ...opts, silentMin: 0 }).length, 0, 'switched off');
  });
  it('an old plugin that talks now', () => {
    A.resetTold();
    const talking = row({ last_seen: NOW - 5000 });
    assert.deepEqual(A.pluginAlertsDue([talking], NOW, opts).map((a) => a.kind), ['outdated']);
    assert.equal(A.pluginAlertsDue([talking], NOW, { ...opts, outdated: false }).length, 0);
    assert.equal(A.pluginAlertsDue([row({ last_seen: NOW - 5000, plugin_version: '0.18.11' })], NOW, opts).length, 0);
  });
});

describe('told once', () => {
  it('checkPlugins tells a silence and an old version once, then stays quiet', () => {
    A.resetTold();
    db.prepare("INSERT INTO servers (id, name, game, host, port, created_at) VALUES (1, 'S', 'vrising', '127.0.0.1', 9876, ?)").run(NOW);
    db.prepare("INSERT INTO game_news_targets (server_id, token_hash, last_seen, plugin_version) VALUES (1, 'x', ?, '0.17.0')").run(NOW - 20 * 60_000);
    assert.equal(A.checkPlugins(NOW), 1);
    assert.equal(A.checkPlugins(NOW + 60_000), 0, 'the same silence is not told again');
    db.prepare('UPDATE game_news_targets SET last_seen = ? WHERE server_id = 1').run(NOW + 120_000);
    assert.equal(A.checkPlugins(NOW + 125_000), 1, 'it talks again and is old: told');
    assert.equal(A.checkPlugins(NOW + 126_000), 0);
  });
});

describe('the settings', () => {
  it('have defaults and refuse a value that is not a choice', () => {
    assert.equal(A.silentMinutes(), 10);
    assert.equal(A.outdatedAlertOn(), true);
    setSetting('gn_alert_silent_min', '30');
    assert.equal(A.silentMinutes(), 30);
    setSetting('gn_alert_silent_min', '7');
    assert.equal(A.silentMinutes(), 10, 'not a choice: the default');
    setSetting('gn_alert_outdated', '0');
    assert.equal(A.outdatedAlertOn(), false);
  });
});
