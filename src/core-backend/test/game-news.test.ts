import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkNews, cleanNews, MAX_VISIBLE, visibleText } from '../src/gamenews/gameNewsLogic.ts';

describe('game news text', () => {
  it('keeps colour, bold and italic tags', () => {
    assert.equal(cleanNews('<color=#ff0000>Вайп</color> <b>завтра</b>'), '<color=#ff0000>Вайп</color> <b>завтра</b>');
  });

  it('cuts out tags that are not allowed and stray angle brackets', () => {
    assert.equal(cleanNews('<size=500>огромно</size> a < b'), 'огромно a b');
    assert.equal(cleanNews('<color=red>x</color>'), 'x');
  });

  it('closes tags left open and drops closing tags without an opening one', () => {
    assert.equal(cleanNews('<color=#00ff00><b>привет'), '<color=#00ff00><b>привет</b></color>');
    assert.equal(cleanNews('привет</b>'), 'привет');
  });

  it('turns line breaks into spaces and removes control characters', () => {
    assert.equal(cleanNews('a\nb\r\nc\u0000d'), 'a b cd');
  });

  it('measures the length without tags', () => {
    assert.equal(visibleText('<color=#ff0000>abc</color>'), 'abc');
    assert.equal(checkNews('<color=#ff0000>' + 'a'.repeat(MAX_VISIBLE) + '</color>').ok, true);
    assert.equal(checkNews('a'.repeat(MAX_VISIBLE + 1)).ok, false);
  });

  it('refuses an empty message and a non-string', () => {
    assert.equal(checkNews('   ').ok, false);
    assert.equal(checkNews('<b></b>').ok, false);
    assert.equal(checkNews(42).ok, false);
  });
});

import { applyVars } from '../src/gamenews/gameNewsLogic.ts';

describe('message variables', () => {
  const vars = { server: 'Мой сервер', online: '12', max: '40', time: '20:05' };
  it('fills in the known ones and leaves the rest', () => {
    assert.equal(applyVars('{server}: {online}/{max}, {time}. {other}', vars), 'Мой сервер: 12/40, 20:05. {other}');
  });
  it('never lets a value bring tags', () => {
    assert.equal(applyVars('{server}', { ...vars, server: '<color=#ff0000>x</color>' }), 'color=#ff0000x/color');
  });
  it('cuts a very long value', () => {
    assert.equal(applyVars('{server}', { ...vars, server: 'a'.repeat(100) }).length, 60);
  });
});

describe('welcome text', () => {
  it('keeps {name} for the plugin', () => {
    assert.equal(checkNews('<color=#5FD068>Привет, {name}!</color>').text, '<color=#5fd068>Привет, {name}!</color>');
  });
});

import { greenName } from '../src/gamenews/gameNewsLogic.ts';

describe('green player name', () => {
  it('colours {name} that is not coloured yet', () => {
    assert.equal(greenName('Привет, {name}!'), 'Привет, <color=#5FD068>{name}</color>!');
    assert.equal(greenName('{name} и {name}'), '<color=#5FD068>{name}</color> и <color=#5FD068>{name}</color>');
  });
  it('leaves a name the administrator coloured', () => {
    assert.equal(greenName('<color=#FF5555>{name}</color> ok {name}'), '<color=#FF5555>{name}</color> ok <color=#5FD068>{name}</color>');
  });
});

import { composeLine, joinLeaveFor, plainLine } from '../src/gamenews/gameNewsJoinLeave.ts';

describe('join and leave messages', () => {
  it('colours the name and the rest of the line separately', () => {
    assert.equal(
      composeLine('* Игрок {name} подключился к серверу.', '#b86bff', '#5fd068'),
      '<color=#5FD068>* Игрок <color=#B86BFF>{name}</color> подключился к серверу.</color>',
    );
  });
  it('keeps the administrator out of the tag syntax', () => {
    assert.equal(plainLine('  <b>hi</b>\n {name}  '), 'bhi/b {name}');
    assert.equal(composeLine('<color=#ff0000>{name}', '#B86BFF', '#5FD068').includes('<color=#ff0000>'), false);
  });
});

describe('size for the game chat', () => {
  it('refuses a message over 500 bytes even when it has fewer than 400 letters', () => {
    const r = checkNews('я'.repeat(300));
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /500 байт/);
    assert.equal(checkNews('я'.repeat(200)).ok, true);
  });
});
