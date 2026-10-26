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

import { cmpVersion, notesBetween, notesText, parseChangelog, parseVersion } from '../src/updateLogic.js';

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

describe('notesBetween / notesText', () => {
  const rel = (version: string, items: string[]) => ({ version, date: null, groups: [{ title: '✨ Новое', titleEn: 'New', items: items.map((text) => ({ text, textEn: null, flags: [] })) }] });
  const all = [rel('1.0.0.20', ['🏅 Анимация']), rel('1.0.0.9', ['🤖 Бот в шапке']), rel('1.0.0.3', ['Старое'])];

  it('everything after the installed version up to the new one', () => {
    assert.deepEqual(notesBetween(all, '1.0.0.3', '1.0.0.20').map((r) => r.version), ['1.0.0.20', '1.0.0.9']);
  });
  it('without a known previous version only the release itself', () => {
    assert.deepEqual(notesBetween(all, null, '1.0.0.9').map((r) => r.version), ['1.0.0.9']);
  });
  it('an unreadable target or the same version gives nothing', () => {
    assert.deepEqual(notesBetween(all, '1.0.0.3', 'abc1234'), []);
    assert.deepEqual(notesBetween(all, '1.0.0.9', '1.0.0.9'), []);
  });
  it('one release: group title and bullets, several: version headings', () => {
    assert.equal(notesText([all[0]!]), '__Новое__\n• 🏅 Анимация');
    assert.match(notesText(all.slice(0, 2)), /^\*\*1\.0\.0\.20\*\*\n__Новое__\n• 🏅 Анимация\n\*\*1\.0\.0\.9\*\*/);
  });
  it('a long list is cut with a count of what is left', () => {
    const out = notesText([rel('1.0.0.5', Array.from({ length: 40 }, (_, i) => `пункт ${i} ${'x'.repeat(30)}`))], 300);
    assert.ok(out.length <= 330);
    assert.match(out, /… и ещё \d+$/);
  });
});
