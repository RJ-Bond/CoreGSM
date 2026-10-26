import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommit, isNoopJob, jobKind, parseChannel, shouldAnnounce, stageOf } from '../src/updateLogic.js';

const run = (progress: number | undefined, message = 'x') => ({ state: 'running', message, time: 1, progress });

describe('update stages', () => {
  it('maps the manager percent to a stage', () => {
    assert.equal(stageOf(run(6)), 'download');
    assert.equal(stageOf(run(12)), 'snapshot');
    assert.equal(stageOf(run(19)), 'snapshot');
    assert.equal(stageOf(run(20)), 'install');
    assert.equal(stageOf(run(96)), 'install');
    assert.equal(stageOf(run(97)), 'health');
  });
  it('knows a rollback by its message and an old manager without percent', () => {
    assert.equal(stageOf(run(35, 'Откат к предыдущей версии: восстанавливаю базу данных…')), 'rollback');
    assert.equal(stageOf(run(undefined)), 'download');
  });
  it('is null when nothing runs', () => {
    assert.equal(stageOf(null), null);
    assert.equal(stageOf({ state: 'done', message: '', time: 1 }), null);
  });
  it('tells a rollback job from an update', () => {
    assert.equal(jobKind('Откат выполнен: работает версия abc'), 'rollback');
    assert.equal(jobKind('Обновление не удалось, выполнен откат на abc'), 'rollback');
    assert.equal(jobKind('Обновлено до версии abc'), 'update');
    assert.equal(isNoopJob('Уже установлена последняя версия (abc)'), true);
  });
});

describe('commit classification', () => {
  it('sorts by the conventional prefix and hides merges', () => {
    assert.equal(classifyCommit('feat(ui): x').kind, 'feat');
    assert.equal(classifyCommit('fix: y').kind, 'fix');
    assert.equal(classifyCommit('Merge pull request #1 from a/b').kind, 'merge');
    assert.equal(classifyCommit('merge main into feat/x').kind, 'merge');
    assert.equal(classifyCommit('docs: z').kind, 'other');
  });
  it('flags breaking changes, migrations and env changes', () => {
    assert.deepEqual(classifyCommit('feat!: drop the old API').flags, ['breaking']);
    assert.deepEqual(classifyCommit('fix: a\n\nBREAKING CHANGE: b').flags, ['breaking']);
    assert.deepEqual(classifyCommit('feat: users table [migration]').flags, ['migration']);
    assert.deepEqual(classifyCommit('feat: x\n\nнужна миграция базы').flags, ['migration']);
    assert.deepEqual(classifyCommit('chore: new variable [env]').flags, ['env']);
    assert.deepEqual(classifyCommit('feat: plain').flags, []);
  });
});

describe('announcements and channel', () => {
  const base = { notify: true, available: true, latest: 'b', announced: 'a', skipped: null };
  it('announces a new build once', () => {
    assert.equal(shouldAnnounce(base), true);
    assert.equal(shouldAnnounce({ ...base, announced: 'b' }), false);
  });
  it('stays quiet when off, not available or skipped', () => {
    assert.equal(shouldAnnounce({ ...base, notify: false }), false);
    assert.equal(shouldAnnounce({ ...base, available: false }), false);
    assert.equal(shouldAnnounce({ ...base, skipped: 'b' }), false);
  });
  it('falls back to the release channel', () => {
    assert.equal(parseChannel('main'), 'main');
    assert.equal(parseChannel('junk'), 'release');
    assert.equal(parseChannel(null), 'release');
  });
});

import { cmpVersion, parseChangelog, parseVersion } from '../src/updateLogic.js';

describe('readable versions', () => {
  it('compares number by number, not as text', () => {
    assert.ok(cmpVersion('1.0.0.9', '1.0.0.10')! < 0);
    assert.ok(cmpVersion('1.1.0.1', '1.0.9.99')! > 0);
    assert.equal(cmpVersion('1.0.0.1', '1.0.0.1'), 0);
    assert.equal(cmpVersion('abcdef123456', '1.0.0.1'), null);
    assert.equal(parseVersion(null), null);
  });
});

describe('CHANGELOG.md', () => {
  const md = `# История изменений

## Правила | Rules
- 🙈 не должно попасть в список | must not be listed

## Не выпущено | Unreleased
### ✨ Новое | New
- 🧩 Вкладка обновлений показывает этапы [migration] | The updates tab shows the steps

## 1.0.0.2 · 26.10.2026
### ✨ Новое | New
- 📈 Графики здоровья | Health charts
- ⚠ Старый API убран | The old API is gone
### 🐛 Исправлено | Fixed
- 🎨 Контраст акцентов

## 1.0.0.1 — 25.10.2026
- Первая версия | First version
`;
  it('reads sections, groups, both languages and flags', () => {
    const r = parseChangelog(md);
    assert.equal(r.length, 3);
    assert.equal(r[0]!.version, null);
    assert.equal(r[0]!.groups[0]!.title, '✨ Новое');
    assert.equal(r[0]!.groups[0]!.titleEn, '✨ New');
    assert.deepEqual(r[0]!.groups[0]!.items[0]!.flags, ['migration']);
    assert.equal(r[0]!.groups[0]!.items[0]!.textEn, '🧩 The updates tab shows the steps');
    assert.equal(r[1]!.version, '1.0.0.2');
    assert.equal(r[1]!.date, '26.10.2026');
    assert.deepEqual(r[1]!.groups.map((g) => g.title), ['✨ Новое', '🐛 Исправлено']);
    assert.deepEqual(r[1]!.groups[0]!.items[1]!.flags, ['breaking']);
    assert.equal(r[1]!.groups[1]!.items[0]!.textEn, null);
    assert.equal(r[2]!.groups[0]!.title, 'Изменения');
    assert.equal(r[2]!.groups[0]!.items[0]!.textEn, 'First version');
  });
});
