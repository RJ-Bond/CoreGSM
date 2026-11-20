import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cardText, channelLine, doneMark, markFor } from '../src/gameSayLogic.ts';

describe('the confirmation of a line sent to the game', () => {
  it('has a mark for every outcome', () => {
    assert.equal(markFor('sent'), '👀');
    assert.equal(markFor('empty'), '📭');
    assert.equal(markFor('rate'), '⏳');
    assert.equal(markFor('error'), '❌');
    assert.equal(doneMark(true), '🎮');
    assert.equal(doneMark(false), '❌');
  });

  it('writes the line in the channel as it stands in the game, in an ansi block, without a prefix', () => {
    const l = channelLine('LINE');
    assert.equal(l.startsWith('```ansi\n'), true);
    assert.equal(l.endsWith('\n```'), true);
    assert.equal(l.includes('→'), false);
    assert.equal(l, '```ansi\nLINE\n```');
  });

  it('shows where the line went with the number of players', () => {
    const c = cardText({ ok: true, status: 'sent', text: 'x', ansi: 'A', servers: [{ name: 'Alpha', players: 3 }, { name: 'Beta', players: null }] });
    assert.equal(c.where, 'Alpha · 3\nBeta');
    assert.equal(c.description, '```ansi\nA\n```');
    assert.equal(cardText({ ok: true, status: 'sent', text: 'готово' }).description, 'готово');
    assert.equal(cardText({ ok: true, status: 'sent', text: 'x' }).where, '—');
  });
});
