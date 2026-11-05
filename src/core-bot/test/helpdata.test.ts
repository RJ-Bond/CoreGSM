import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLURB, CATEGORIES, CMDS, categoryOf, cmdInfo, langOf, liveLine, meLine, shortItem, shortText, suggestCommands, visibleCategories } from '../src/helpData.js';

test('language from the Discord locale', () => {
  assert.equal(langOf('ru'), 'ru');
  assert.equal(langOf('en-US'), 'en');
  assert.equal(langOf('en-GB'), 'en');
  assert.equal(langOf('de'), 'en');
  assert.equal(langOf(undefined), 'ru');
  assert.equal(langOf(''), 'ru');
});

test('moderation is for administrators only', () => {
  const ids = (a: boolean) => visibleCategories(a).map((c) => c.id);
  assert.ok(!ids(false).includes('mod') && !ids(false).includes('modclr'));
  assert.ok(ids(true).includes('mod') && ids(true).includes('modclr'));
  assert.ok(ids(false).includes('news'));
});

test('every command is in one section, has details in both languages and a blurb exists for every section', () => {
  for (const c of CMDS) {
    assert.ok(categoryOf(c.cmd), c.cmd);
    assert.ok(c.text.ru && c.text.en && c.needs.ru && c.needs.en && c.usage.startsWith(c.cmd) && c.examples.length > 0, c.cmd);
  }
  for (const cat of CATEGORIES) {
    assert.ok(BLURB[cat.id], cat.id);
    for (const n of cat.cmds) assert.ok(cmdInfo(n), n);
    assert.ok(cat.label.ru && cat.label.en && cat.title.ru && cat.title.en);
  }
  assert.equal(new Set(CATEGORIES.map((c) => c.id)).size, CATEGORIES.length);
  assert.ok(CATEGORIES.length + 1 <= 25, 'the menu fits 25 options');
});

test('/help command: lookup and autocomplete respect the rights', () => {
  assert.equal(cmdInfo('ban')?.cmd, '/ban');
  assert.equal(cmdInfo('/ban')?.cmd, '/ban');
  assert.equal(cmdInfo('nope'), undefined);
  const names = (q: string, admin: boolean) => suggestCommands(q, admin, 'ru').map((x) => x.value);
  assert.ok(names('ba', true).includes('ban'));
  assert.ok(!names('ba', false).includes('ban'), 'a player does not get moderation commands');
  assert.ok(names('', false).includes('online'));
  assert.ok(suggestCommands('', true, 'en').every((x) => x.name.length <= 100 && x.value.length <= 100));
  assert.ok(suggestCommands('', true, 'en').length <= 25);
  assert.ok(names('карточк', false).includes('profile'), 'search by the description too');
});

test('texts: live line, the line about the person, short changelog items', () => {
  assert.match(liveLine({ players: 13, up: 4, total: 4 }, 'ru'), /🟢 Сейчас играют \*\*13\*\* · серверов в сети \*\*4 из 4\*\*/);
  assert.match(liveLine({ players: 0, up: 0, total: 2 }, 'en'), /🔴 Playing now: \*\*0\*\*/);
  assert.equal(meLine(null, 'ru'), '');
  assert.match(meLine({ found: false, gameNick: '', rank: null }, 'ru'), /\/link/);
  assert.match(meLine({ found: true, gameNick: '', rank: null }, 'ru'), /\/link/);
  assert.equal(meLine({ found: true, gameNick: 'Bob', rank: { name: 'Рекрут', hours: 12.5 } }, 'en'), '👤 **Bob** · Рекрут · 12.5 h');
  assert.equal(shortItem('🧹 Команда `/clear` — очищает чат'), '🧹 Команда `/clear`');
  assert.equal(shortItem('x'.repeat(300)).length, 130);
});

test('short notes for the lists', () => {
  assert.equal(shortText('создать аккаунт в панели через Discord, пароль не нужен'), 'создать аккаунт в панели через Discord');
  assert.equal(shortText('сколько игроков на каждом сервере'), 'сколько игроков на каждом сервере');
  assert.ok(shortText('x'.repeat(100)).length <= 48);
  for (const c of CMDS) assert.ok(shortText(c.text.ru).length > 3 && shortText(c.text.en).length > 3, c.cmd);
});
