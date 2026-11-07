import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_COLORS, activeChatKinds, ansiChatLine, ansiEventLine, chunkLines, escapeDiscord, formatChatLine, formatEventLine, isDiscordWebhook, normalizeChat, wrapForDiscord,
} from '../src/gamenews/gameNewsChatLogic.ts';

describe('game chat for Discord', () => {
  it('writes a line as «[Общий] ник: текст»', () => {
    assert.equal(formatChatLine('global', 'WhiteLegioN', '', 'Тест'), '**[Глобальный]** **WhiteLegioN**: Тест');
    assert.equal(formatChatLine('local', 'Vamp', '', 'привет'), '**[Локальный]** **Vamp**: привет');
  });

  it('puts the clan name into the clan tag', () => {
    assert.equal(formatChatLine('clan', 'Vamp', 'Ночные', 'сбор'), '**[Клан Ночные]** **Vamp**: сбор');
    assert.equal(formatChatLine('clan', 'Vamp', '', 'сбор'), '**[Клан]** **Vamp**: сбор');
  });

  it('names the server only when it is asked to', () => {
    assert.equal(formatChatLine('global', 'A', '', 'x', 'Мой сервер'), '**[Мой сервер]** **[Глобальный]** **A**: x');
  });

  it('does not forward commands or empty texts', () => {
    assert.equal(formatChatLine('global', 'A', '', '.register пароль пароль'), '');
    assert.equal(formatChatLine('global', 'A', '', '/help'), '');
    assert.equal(formatChatLine('global', 'A', '', '   '), '');
  });

  it('makes a text harmless: no mentions, no markdown', () => {
    assert.equal(escapeDiscord('@everyone **bold** _x_ `c` <@123> > q'), '@\u200beveryone \\*\\*bold\\*\\* \\_x\\_ \\`c\\` \\<@\u200b123\\> \\> q');
    assert.equal(escapeDiscord('a\nb'), 'a b');
    assert.equal(formatChatLine('global', '**Admin**', '', '@here hi').includes('@here'), false);
  });

  it('cuts a very long text and groups lines into messages', () => {
    assert.equal(formatChatLine('global', 'A', '', 'я'.repeat(900)).length < 560, true);
    const lines = Array.from({ length: 30 }, (_, i) => `${i}`.padEnd(100, 'x'));
    const chunks = chunkLines(lines, 1000);
    assert.equal(chunks.every((c) => c.length <= 1000), true);
    assert.equal(chunks.join('\n').split('\n').length, 30);
  });

  it('accepts only Discord webhooks', () => {
    const ok = 'https://discord.com/api/webhooks/1234567890123456789/abcdefghijklmnopqrstuvwxyzABCDEFGH-_0123456789';
    assert.equal(isDiscordWebhook(ok), true);
    assert.equal(isDiscordWebhook(ok.replace('discord.com', 'discordapp.com')), true);
    assert.equal(isDiscordWebhook('http://discord.com/api/webhooks/1234567890123456789/abcdefghijklmnopqrstuvwxyz'), false);
    assert.equal(isDiscordWebhook('https://evil.example/api/webhooks/1234567890123456789/abcdefghijklmnopqrstuvwxyz'), false);
    assert.equal(isDiscordWebhook('https://discord.com.evil.example/api/webhooks/1234567890123456789/abcdefghijklmnopqrstuvwxyz'), false);
    assert.equal(isDiscordWebhook('https://192.168.1.1/api/webhooks/1234567890123456789/abcdefghijklmnopqrstuvwxyz'), false);
  });

  it('keeps one webhook and a switch per kind of chat', () => {
    const s = normalizeChat({ enabled: true, webhook: 'enc:x', kinds: { global: true, clan: false } });
    assert.deepEqual(s.kinds, { global: true, clan: false, local: true, join: false, leave: false });
    assert.deepEqual(activeChatKinds(s), ['global', 'local']);
    assert.deepEqual(activeChatKinds({ ...s, enabled: false }), []);
    assert.deepEqual(activeChatKinds({ ...s, webhook: '' }), []);
  });

  it('turns an old setting with a webhook per chat into one webhook', () => {
    const s = normalizeChat({ enabled: true, webhooks: { clan: 'enc:clan', local: 'enc:local' } });
    assert.equal(s.webhook, 'enc:clan');
    assert.deepEqual(s.kinds, { global: false, clan: true, local: true, join: false, leave: false });
    const d = normalizeChat(undefined);
    assert.deepEqual(d.kinds, { global: true, clan: true, local: true, join: false, leave: false });
    assert.equal(d.style, 'ansi');
    assert.equal(d.senderName, '');
  });

  it('colours a chat line like the game: a blue tag, a yellow nickname', () => {
    const ESC = String.fromCharCode(27);
    const line = ansiChatLine('global', 'WhiteLegioN', '', 'тест', DEFAULT_COLORS.global);
    assert.equal(line, `${ESC}[1;34m[Глобальный]${ESC}[0m ${ESC}[1;33mWhiteLegioN${ESC}[0m${ESC}[0;36m: ${ESC}[0m${ESC}[0;36mтест${ESC}[0m`);
    assert.equal(ansiChatLine('global', 'A', '', '.register x x', DEFAULT_COLORS.global), '');
    assert.match(ansiChatLine('clan', 'A', 'Ночные', 'x', DEFAULT_COLORS.clan), /\[Клан Ночные\]/);
  });

  it('writes a join with a purple nickname in green text', () => {
    const ESC = String.fromCharCode(27);
    const line = ansiEventLine('* Игрок {name} подключился к серверу.', 'WhiteLegioN', DEFAULT_COLORS.join);
    assert.equal(line, `${ESC}[0;32m* Игрок ${ESC}[0m${ESC}[1;35mWhiteLegioN${ESC}[0m${ESC}[0;32m подключился к серверу.${ESC}[0m`);
    assert.equal(formatEventLine('* Игрок {name} подключился к серверу.', 'WhiteLegioN'), '\\* Игрок **WhiteLegioN** подключился к серверу.');
  });

  it('keeps a player from closing the code block or injecting colours', () => {
    const ESC = String.fromCharCode(27);
    const line = ansiChatLine('global', 'A', '', 'x ```@everyone``` ' + ESC + '[31mred', DEFAULT_COLORS.global);
    assert.equal(line.includes('```'), false);
    assert.equal(line.includes(ESC + '[31m'), false);
    assert.equal(wrapForDiscord('ansi', 'a'), '```ansi\na\n```');
    assert.equal(wrapForDiscord('plain', 'a'), 'a');
  });
});
