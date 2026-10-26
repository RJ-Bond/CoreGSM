import { describe, expect, it } from 'vitest';
import { cmpVersion, groupCommits, isNewerRelease, preflightWarnings, stepStates, upcomingFlags, versionText } from './updateLogic';
import type { ChangelogItem, UpdateNotesRelease } from '../../api';

describe('update versions', () => {
  it('prefers the readable version over the hash', () => {
    expect(versionText('1.0.0.7', 'abcdef123456')).toBe('1.0.0.7');
    expect(versionText(null, 'abcdef123456')).toBe('abcdef1');
    expect(versionText(null, null)).toBe('–');
  });
  it('compares numerically', () => {
    expect(cmpVersion('1.0.0.9', '1.0.0.10')!).toBeLessThan(0);
    expect(cmpVersion('abc', '1.0.0.1')).toBeNull();
  });
});

describe('update steps', () => {
  it('marks done, active and todo around the current stage', () => {
    expect(stepStates('install', false).map((s) => s.state)).toEqual(['done', 'done', 'active', 'todo']);
    expect(stepStates('download', false).map((s) => s.state)).toEqual(['active', 'todo', 'todo', 'todo']);
    expect(stepStates(null, true).map((s) => s.state)).toEqual(['done', 'done', 'done', 'done']);
    expect(stepStates('rollback', false).map((s) => s.state)).toEqual(['todo', 'todo', 'todo', 'todo']);
  });
});

describe('preflight warnings', () => {
  const now = Date.UTC(2026, 9, 26, 12);
  it('warns about players and about a missing or old backup', () => {
    expect(preflightWarnings({ onlineServers: 2, players: 5, lastBackupAt: now - 3_600_000 }, now)).toEqual([{ kind: 'players', n: 5 }]);
    expect(preflightWarnings({ onlineServers: 0, players: 0, lastBackupAt: null }, now)).toEqual([{ kind: 'noBackup' }]);
    expect(preflightWarnings({ onlineServers: 0, players: 0, lastBackupAt: now - 50 * 3_600_000 }, now)).toEqual([{ kind: 'oldBackup', hours: 50 }]);
    expect(preflightWarnings(null, now)).toEqual([]);
  });
});

describe('release notes', () => {
  const rels: UpdateNotesRelease[] = [
    { version: null, date: null, groups: [{ title: 'Новое', items: [{ text: 'x', flags: [] }] }] },
    { version: '1.0.0.8', date: null, groups: [{ title: 'Новое', items: [{ text: 'Таблица [migration]', flags: ['migration'] }, { text: '⚠ Старый API убран', flags: ['breaking'] }] }] },
    { version: '1.0.0.5', date: null, groups: [{ title: 'Новое', items: [{ text: 'Старое [env]', flags: ['env'] }] }] },
  ];
  it('takes only releases newer than the running one', () => {
    expect(isNewerRelease(rels[0]!, '1.0.0.6')).toBe(false);
    expect(isNewerRelease(rels[1]!, '1.0.0.6')).toBe(true);
    expect(isNewerRelease(rels[2]!, '1.0.0.6')).toBe(false);
    expect(isNewerRelease(rels[1]!, null)).toBe(false);
  });
  it('lists the flags of the newer releases without the markers', () => {
    expect(upcomingFlags(rels, '1.0.0.6')).toEqual([{ flag: 'migration', text: 'Таблица' }, { flag: 'breaking', text: 'Старый API убран' }]);
  });
  it('warns in the language of the interface and drops the markers', () => {
    const r: UpdateNotesRelease[] = [{ version: '1.0.0.8', date: null, groups: [{ title: 'x', items: [{ text: '⚠️ Старый API убран', textEn: '⚠️ The old API is gone', flags: ['breaking'] }] }] }];
    expect(upcomingFlags(r, '1.0.0.6', 'en')).toEqual([{ flag: 'breaking', text: 'The old API is gone' }]);
    expect(upcomingFlags(r, '1.0.0.6')).toEqual([{ flag: 'breaking', text: 'Старый API убран' }]);
  });
  it('groups commits without merges and marks the ones after the installation', () => {
    const items: ChangelogItem[] = [
      { sha: '1', title: 'feat: a', date: 2000, url: '', kind: 'feat' },
      { sha: '2', title: 'Merge pull request', date: 2000, url: '', kind: 'merge' },
      { sha: '3', title: 'fix: b', date: 500, url: '', kind: 'fix' },
    ];
    const g = groupCommits(items, 1000);
    expect(g.map((x) => x.id)).toEqual(['feat', 'fix']);
    expect(g[0]!.items[0]!.isNew).toBe(true);
    expect(g[1]!.items[0]!.isNew).toBe(false);
  });
});
