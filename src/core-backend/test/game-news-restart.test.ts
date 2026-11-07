import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { announceLine, cancelLine, DEFAULT_TEXTS, formatLeft, nextNotice, noticeSeconds, parseDuration } from '../src/gamenews/gameNewsRestartLogic.ts';

describe('restart timer: the time a person types', () => {
  it('reads minutes, seconds and hours in Latin and Cyrillic', () => {
    assert.deepEqual(parseDuration('5m'), { seconds: 300 });
    assert.deepEqual(parseDuration('5м'), { seconds: 300 });
    assert.deepEqual(parseDuration('5 мин'), { seconds: 300 });
    assert.deepEqual(parseDuration('30s'), { seconds: 30 });
    assert.deepEqual(parseDuration('30с'), { seconds: 30 });
    assert.deepEqual(parseDuration('1h'), { seconds: 3600 });
    assert.deepEqual(parseDuration('1ч'), { seconds: 3600 });
    assert.deepEqual(parseDuration('1h30m'), { seconds: 5400 });
    assert.deepEqual(parseDuration('1ч 30м'), { seconds: 5400 });
    assert.deepEqual(parseDuration('1,5m'), { seconds: 90 });
  });

  it('takes a bare number as minutes', () => {
    assert.deepEqual(parseDuration('5'), { seconds: 300 });
    assert.deepEqual(parseDuration(' 10 '), { seconds: 600 });
  });

  it('refuses nonsense, too short and too long', () => {
    assert.deepEqual(parseDuration(''), { error: 'format' });
    assert.deepEqual(parseDuration('скоро'), { error: 'format' });
    assert.deepEqual(parseDuration('5x'), { error: 'format' });
    assert.deepEqual(parseDuration('5m abc'), { error: 'format' });
    assert.deepEqual(parseDuration('5s'), { error: 'short' });
    assert.deepEqual(parseDuration('7h'), { error: 'long' });
  });
});

describe('restart timer: saying the time left', () => {
  it('uses the right Russian forms', () => {
    assert.equal(formatLeft(300), '5 минут');
    assert.equal(formatLeft(240), '4 минуты');
    assert.equal(formatLeft(60), '1 минуту');
    assert.equal(formatLeft(120), '2 минуты');
    assert.equal(formatLeft(660), '11 минут');
    assert.equal(formatLeft(30), '30 секунд');
    assert.equal(formatLeft(21), '21 секунду');
    assert.equal(formatLeft(5400), '1 час 30 минут');
    assert.equal(formatLeft(7200), '2 часа');
  });
});

describe('restart timer: when the chat is told', () => {
  it('speaks at the points and not between them', () => {
    // from five minutes: 4, 3, 2, 1 minute, then 30, 15, 10, 5 seconds
    let last = 300;
    const said: number[] = [];
    for (let r = 299; r > 0; r--) {
      const p = nextNotice(r, last);
      if (p !== null) { said.push(p); last = p; }
    }
    assert.deepEqual(said, [240, 180, 120, 60, 30, 15, 10, 5]);
  });

  it('does not repeat a point', () => {
    assert.equal(nextNotice(240, 240), null);
    assert.equal(nextNotice(239, 240), null);
  });

  it('after a pause says the nearest point, not a stale one', () => {
    assert.equal(nextNotice(100, 300), 120);
    assert.equal(noticeSeconds(120, 100), 100);
    assert.equal(noticeSeconds(240, 238), 240);
  });

  it('says nothing when the time is up', () => {
    assert.equal(nextNotice(0, 5), null);
  });
});

describe('restart timer: the lines', () => {
  it('is yellow, and red for the last minute', () => {
    assert.match(announceLine(DEFAULT_TEXTS, 300), /^<color=#FFCC33>\* Внимание! Рестарт сервера будет произведен через 5 минут\.<\/color>$/);
    assert.match(announceLine(DEFAULT_TEXTS, 30), /^<color=#FF5555>/);
    assert.match(cancelLine(DEFAULT_TEXTS), /отменён/);
  });
  it('lets the administrator change the words but not the tags', () => {
    const line = announceLine({ ...DEFAULT_TEXTS, announce: '<size=99>Через {time}!' }, 120);
    assert.equal(line.includes('<size'), false);
    assert.match(line, /Через 2 минуты!/);
  });
});
