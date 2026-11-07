import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chunkLines, escapeDiscord, formatChatLine, isDiscordWebhook } from '../src/gamenews/gameNewsChatLogic.ts';

describe('game chat for Discord', () => {
  it('writes a line as «[Общий] ник: текст»', () => {
    assert.equal(formatChatLine('global', 'WhiteLegioN', '', 'Тест'), '**[Общий]** **WhiteLegioN**: Тест');
    assert.equal(formatChatLine('local', 'Vamp', '', 'привет'), '**[Рядом]** **Vamp**: привет');
  });

  it('puts the clan name into the clan tag', () => {
    assert.equal(formatChatLine('clan', 'Vamp', 'Ночные', 'сбор'), '**[Клан Ночные]** **Vamp**: сбор');
    assert.equal(formatChatLine('clan', 'Vamp', '', 'сбор'), '**[Клан]** **Vamp**: сбор');
  });

  it('names the server only when it is asked to', () => {
    assert.equal(formatChatLine('global', 'A', '', 'x', 'Мой сервер'), '**[Мой сервер]** **[Общий]** **A**: x');
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
});
