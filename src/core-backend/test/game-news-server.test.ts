/** Settings per server, restart timers (start, postpone, cancel, history, empty server), the channels the bot listens to, and the silent-plugin watch. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-gns-'));
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ??= 'i'.repeat(48);
const { db, getSetting, setSetting } = await import('../src/db.ts');
const scope = await import('../src/gamenews/gameNewsScope.ts');
const state = await import('../src/gamenews/gameNewsRestartState.ts');
const restart = await import('../src/gamenews/gameNewsServerRestart.ts');
const chat = await import('../src/gamenews/gameNewsChat.ts');
const watch = await import('../src/gamenews/gameNewsWatch.ts');
await import('../src/monitoring/restarts.ts'); // these make the tables that the lines of the chat read
await import('../src/monitoring/wipes.ts');
const { getWelcome } = await import('../src/gamenews/gameNewsWelcome.ts');
const register = await import('../src/gamenews/gameNewsRegister.ts');
const { encryptSecret } = await import('../src/security/secrets.ts');

const NOW = 1_900_000_000_000;

// two servers with a plugin token
for (const [id, name] of [[1, 'Alpha'], [2, 'Beta']] as const) {
  db.prepare('INSERT INTO servers (id, name, game, host, port, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, 'vrising', '10.0.0.' + id, 9876, NOW);
  db.prepare("INSERT INTO game_news_targets (server_id, url, token, token_hash) VALUES (?, '', '', ?)").run(id, `hash${id}`);
}
const hook = encryptSecret(['https:', '', 'discord.com', 'api', 'webhooks', '1234567890123456789', 'abcdefghijklmnopqrstuvwxyzABCDEFGH-_0123456789'].join('/'));

describe('settings per server', () => {
  it('a server without its own value reads the general one', () => {
    setSetting('gamenews_welcome', JSON.stringify({ enabled: true, text: 'общий', split: false, newText: '' }));
    assert.equal(getWelcome(1).text, 'общий');
    assert.equal(scope.hasOverride('gamenews_welcome', 1), false);
  });

  it('its own value wins for that server only, and can be taken back', () => {
    scope.writeScoped('gamenews_welcome', JSON.stringify({ enabled: true, text: 'свой', split: false, newText: '' }), 1);
    assert.equal(getWelcome(1).text, 'свой');
    assert.equal(getWelcome(2).text, 'общий');
    assert.equal(getWelcome().text, 'общий');
    assert.deepEqual(scope.overrides().gamenews_welcome, [1]);
    scope.clearOverride('gamenews_welcome', 1);
    assert.equal(getWelcome(1).text, 'общий');
    assert.deepEqual(scope.overrides().gamenews_welcome, []);
  });
});

describe('restart timer', () => {
  it('starts, tells the chat, and writes the history', () => {
    const j = restart.startRestart(1, 300, 'админ', 'панель', NOW);
    assert.equal(j.immediate, false);
    assert.equal(state.getJob(1)?.state, 'counting');
    assert.equal(state.recentLog(1)[0].outcome, 'counting');
  });

  it('postpones: the end moves, the notices start again from the new time', () => {
    const r = restart.postponeRestart(1, 300, NOW + 100_000);
    assert.equal(r.ok, true);
    const j = state.getJob(1)!;
    assert.equal(j.run_at, NOW + 100_000 + 500_000);
    assert.equal(j.total_sec, 500);
    assert.equal(j.state, 'counting');
  });

  it('cannot postpone more than six hours, nor a timer that is not running', () => {
    restart.postponeRestart(1, 3600, NOW + 100_000);
    assert.equal((state.getJob(1)!.run_at - (NOW + 100_000)) / 1000 <= 6 * 3600, true);
    assert.equal(restart.postponeRestart(2, 60, NOW).ok, false);
  });

  it('runs out: due, handed to the plugin once, history says done', () => {
    restart.startRestart(2, 20, 'админ', 'панель', NOW);
    restart.tickRestartJobs(NOW + 21_000);
    assert.equal(state.getJob(2)?.state, 'due');
    assert.equal(state.consumeDue(2), true);
    assert.equal(state.consumeDue(2), false);
    assert.equal(state.getJob(2)?.state, 'sent');
    assert.equal(state.recentLog(5).find((h) => h.server_id === 2)?.outcome, 'done');
  });

  it('a timer nobody took is dropped after three minutes', () => {
    restart.startRestart(2, 20, 'админ', 'панель', NOW);
    restart.tickRestartJobs(NOW + 21_000);
    restart.tickRestartJobs(NOW + 20_000 + state.DUE_GRACE_MS + 1000);
    assert.equal(state.getJob(2)?.state, 'missed');
    assert.equal(state.recentLog(5).find((h) => h.server_id === 2)?.outcome, 'missed');
  });

  it('cancel stops it and is written to the history', () => {
    restart.startRestart(2, 600, 'админ', 'панель', NOW);
    assert.equal(restart.cancelRestart(2, NOW + 1000), true);
    assert.equal(restart.cancelRestart(2, NOW + 2000), false);
    assert.equal(state.recentLog(5).find((h) => h.server_id === 2)?.outcome, 'cancelled');
  });

  it('a new timer replaces the running one in the history', () => {
    restart.startRestart(2, 600, 'a', 'панель', NOW);
    restart.startRestart(2, 900, 'b', 'панель', NOW + 1000);
    const rows = state.recentLog(20).filter((h) => h.server_id === 2);
    assert.equal(rows[0].outcome, 'counting');
    assert.equal(rows[1].outcome, 'replaced');
  });

  it('an empty server restarts at once, unless the switch is off', () => {
    db.prepare('UPDATE game_news_targets SET last_seen = ?, plugin_players = 0 WHERE server_id = 1').run(NOW);
    const j = restart.startRestart(1, 600, 'админ', 'панель', NOW + 1000);
    assert.equal(j.immediate, true);
    assert.equal(state.getJob(1)?.state, 'due');
    setSetting('gamenews_restart_empty', '0');
    const k = restart.startRestart(1, 600, 'админ', 'панель', NOW + 2000);
    assert.equal(k.immediate, false);
    setSetting('gamenews_restart_empty', null);
  });

  it('players online: the countdown runs', () => {
    db.prepare('UPDATE game_news_targets SET last_seen = ?, plugin_players = 3 WHERE server_id = 1').run(NOW);
    assert.equal(restart.startRestart(1, 600, 'админ', 'панель', NOW + 1000).immediate, false);
  });

  it('the command text: time, cancel, status, and wrong input', () => {
    assert.equal(restart.runRestartCommand(2, 'скоро', 'x', 'игра', NOW).ok, false);
    assert.equal(restart.runRestartCommand(2, '5s', 'x', 'игра', NOW).ok, false);
    assert.match(restart.runRestartCommand(2, '5м', 'x', 'игра', NOW).text, /через 5 минут/);
    assert.match(restart.runRestartCommand(2, '', 'x', 'игра', NOW).text, /Рестарт через/);
    assert.equal(restart.runRestartCommand(2, 'cancel', 'x', 'игра', NOW).ok, true);
  });
});

describe('channels the bot listens to', () => {
  const stored = (extra: Record<string, unknown>) => JSON.stringify({ enabled: true, webhook: hook, fromDiscord: true, channelId: '111111111111111111', ...extra });

  it('nothing is listened to until it is switched on', () => {
    assert.deepEqual(chat.chatChannels(), []);
    setSetting('gamenews_chat', stored({ fromDiscord: false }));
    assert.deepEqual(chat.chatChannels(), []);
  });

  it('the general channel serves the servers that have no chat settings of their own', () => {
    setSetting('gamenews_chat', stored({}));
    assert.deepEqual(chat.chatChannels(), [{ channelId: '111111111111111111', serverIds: [1, 2], confirmCard: true, confirmLine: true }]);
  });

  it('a server with its own channel is served by that one only', () => {
    scope.writeScoped('gamenews_chat', stored({ channelId: '222222222222222222' }), 2);
    const list = chat.chatChannels();
    assert.deepEqual(list.find((c) => c.channelId === '111111111111111111')?.serverIds, [1]);
    assert.deepEqual(list.find((c) => c.channelId === '222222222222222222')?.serverIds, [2]);
  });

  it('carries the way the line is confirmed: a card and a line in the channel, each can be off', () => {
    setSetting('gamenews_chat', stored({ confirmCard: false, confirmLine: false }));
    const c = chat.chatChannels().find((x) => x.channelId === '111111111111111111');
    assert.equal(c?.confirmCard, false);
    assert.equal(c?.confirmLine, false);
    setSetting('gamenews_chat', stored({}));
  });

  it('a channel that is not known is not listened to; a switched-off chat is not either', () => {
    scope.writeScoped('gamenews_chat', stored({ enabled: false, channelId: '222222222222222222' }), 2);
    assert.equal(chat.chatChannels().some((c) => c.channelId === '222222222222222222'), false);
  });
});

describe('the plugin has been silent', () => {
  it('says what state a plugin is in', () => {
    assert.equal(watch.pluginState(0, NOW), 'never');
    assert.equal(watch.pluginState(NOW - 60_000, NOW), 'ok');
    assert.equal(watch.pluginState(NOW - watch.SILENT_MS - 1000, NOW), 'silent');
  });

  it('alerts once, then again when it is back', () => {
    setSetting('alerts_enabled', '1');
    setSetting('alerts_channel', '333333333333333333');
    db.prepare('UPDATE game_news_targets SET last_seen = ? WHERE server_id = 1').run(NOW - 10 * 60_000);
    db.prepare('UPDATE game_news_targets SET last_seen = 0 WHERE server_id = 2').run();
    state.setState(1, 'cancelled');
    assert.equal(watch.checkPluginSilence(NOW), 1);
    assert.equal(watch.checkPluginSilence(NOW + 60_000), 0);
    assert.deepEqual(JSON.parse(getSetting('gamenews_silent') ?? '[]'), [1]);
    db.prepare('UPDATE game_news_targets SET last_seen = ? WHERE server_id = 1').run(NOW + 120_000);
    assert.equal(watch.checkPluginSilence(NOW + 125_000), 1);
    assert.equal(getSetting('gamenews_silent'), null);
  });

  it('keeps quiet while a server restarts on purpose', () => {
    db.prepare('UPDATE game_news_targets SET last_seen = ? WHERE server_id = 1').run(NOW - 10 * 60_000);
    state.saveJob({ server_id: 1, run_at: NOW - 6 * 60_000, started_at: NOW - 12 * 60_000, total_sec: 360, last_notice: 0, requested_by: 'x', source: 'панель', state: 'sent' });
    assert.equal(watch.checkPluginSilence(NOW), 0);
    assert.equal(getSetting('gamenews_silent'), null);
  });
});

describe('the hint a player reads about .register and .login', () => {
  it('picks the commands out: white bold, the arguments in lilac, the rest in the colour of the line', () => {
    const line = register.tag('#FFCC33', '* Новый аккаунт: .register (пароль) (подтверждение). Есть аккаунт: .login (логин) (пароль)');
    assert.equal(line.includes('<color=#FFFFFF><b>.register</b></color>'), true);
    assert.equal(line.includes('<color=#B9A7FF> (пароль) (подтверждение)</color>'), true);
    assert.equal(line.includes('<color=#FFFFFF><b>.login</b></color>'), true);
    assert.equal(line.startsWith('<color=#FFCC33>* Новый аккаунт: </color>'), true);
    assert.equal((line.match(/<color/g) ?? []).length, (line.match(/<\/color>/g) ?? []).length);
  });

  it('keeps a text without commands in one colour and strips tags a person typed', () => {
    assert.equal(register.tag('#5FD068', '* Готово! <size=99>x'), '<color=#5FD068>* Готово! size=99x</color>');
    assert.equal(register.tag('#5FD068', 'ну и точка.'), '<color=#5FD068>ну и точка.</color>');
  });

  it('moves the first wording of the hint to the new one, and keeps a changed text', () => {
    const old = '* Вы ещё не зарегистрированы в панели. Для регистрации введите .register пароль подтверждение_пароля';
    setSetting('gamenews_register', JSON.stringify({ enabled: true, promptText: old }));
    assert.match(register.getRegisterSettings().promptText, /\.login \(логин\) \(пароль\)/);
    setSetting('gamenews_register', JSON.stringify({ enabled: true, promptText: 'мой текст' }));
    assert.equal(register.getRegisterSettings().promptText, 'мой текст');
    setSetting('gamenews_register', null);
  });
});
