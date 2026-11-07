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
    assert.equal(applyVars('{server}', { ...vars, server: 'a'.repeat(300) }).length, 200);
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

import { greetingFor, leftText } from '../src/gamenews/gameNewsVars.ts';

describe('new message variables', () => {
  it('fills all nine and keeps unknown words', () => {
    const v = { server: 'S', online: '3', max: '40', time: '20:05', greeting: 'Добрый вечер', restart: '3 ч 20 мин', wipe: '12.11, 20:00', discord: 'discord.gg/x', tip: 'Сохраняйтесь' };
    assert.equal(applyVars('{greeting}! {server}: {online}/{max}. Рестарт: {restart}. Вайп: {wipe}. {discord} {tip} {x}', v),
      'Добрый вечер! S: 3/40. Рестарт: 3 ч 20 мин. Вайп: 12.11, 20:00. discord.gg/x Сохраняйтесь {x}');
  });
  it('greets by the time of day', () => {
    assert.equal(greetingFor(7), 'Доброе утро');
    assert.equal(greetingFor(14), 'Добрый день');
    assert.equal(greetingFor(20), 'Добрый вечер');
    assert.equal(greetingFor(2), 'Доброй ночи');
    assert.equal(greetingFor(23), 'Доброй ночи');
  });
  it('says how long is left', () => {
    assert.equal(leftText(20_000), 'менее минуты');
    assert.equal(leftText(45 * 60_000), '45 мин');
    assert.equal(leftText((3 * 60 + 20) * 60_000), '3 ч 20 мин');
    assert.equal(leftText(2 * 3_600_000), '2 ч');
    assert.equal(leftText(50 * 3_600_000), '2 д 2 ч');
  });
});

import { loginFromNick } from '../src/gamenews/gameNewsLogic.ts';

describe('login from a game nickname', () => {
  const none = () => false;
  it('keeps a good nickname as it is', () => {
    assert.equal(loginFromNick('WhiteLegioN', '76561198000000001', none), 'WhiteLegioN');
    assert.equal(loginFromNick('Белый Легион', '76561198000000001', none), 'Белый Легион');
  });
  it('replaces characters the site does not allow', () => {
    assert.equal(loginFromNick('[RU] Vamp!re*', '76561198000000001', none), '_RU_ Vamp_re_');
  });
  it('gives a short or empty name a login made from the game id', () => {
    assert.equal(loginFromNick('ab', '76561198000001234', none), 'Player_1234');
    assert.equal(loginFromNick('   ', '76561198000001234', none), 'Player_1234');
  });
  it('adds a number while the login is taken, within 32 characters', () => {
    const used = new Set(['Vamp', 'Vamp2']);
    assert.equal(loginFromNick('Vamp', '76561198000000001', (l) => used.has(l)), 'Vamp3');
    const long = 'x'.repeat(40);
    const l = loginFromNick(long, '76561198000000001', (c) => c === 'x'.repeat(32));
    assert.equal(l.length <= 32, true);
    assert.equal(l.endsWith('2'), true);
  });
});
