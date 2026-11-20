import { describe, expect, it } from 'vitest';
import { adviceKey, groupDays, isProblem, relatedOf, tookSeconds, type Entry } from '../src/pages/journalLogic';

const MIN = 60_000;
const T0 = new Date('2026-11-18T12:00:00').getTime();
let n = 0;
const e = (p: Partial<Entry> = {}): Entry => ({ id: `m${++n}`, ts: T0, kind: 'message', serverId: 1, serverName: 'A', text: 'hi', status: 'delivered', error: '', by: 'admin', ...p });

describe('what is a problem', () => {
  it('a message that did not reach the game, a missed restart, a note of the plugin (but not a save)', () => {
    expect(isProblem(e({ status: 'failed' }))).toBe(true);
    expect(isProblem(e({ status: 'expired', kind: 'auto' }))).toBe(true);
    expect(isProblem(e({ status: 'delivered' }))).toBe(false);
    expect(isProblem(e({ kind: 'restart', status: 'missed' }))).toBe(true);
    expect(isProblem(e({ kind: 'restart', status: 'done' }))).toBe(false);
    expect(isProblem(e({ kind: 'plugin', status: 'freeze' }))).toBe(true);
    expect(isProblem(e({ kind: 'plugin', status: 'save' }))).toBe(false);
  });
});

describe('advice for an error', () => {
  it('names what to do about the known causes, and nothing for the rest', () => {
    expect(adviceKey(e({ status: 'expired', error: 'Плагин не забрал сообщение за 5 минут' }))).toBe('gn.jn.adv.expired');
    expect(adviceKey(e({ status: 'failed', error: 'Для сервера не создан токен плагина' }))).toBe('gn.jn.adv.token');
    expect(adviceKey(e({ status: 'failed', error: 'Мир сервера ещё не создан' }))).toBe('gn.jn.adv.world');
    expect(adviceKey(e({ status: 'failed', error: 'что-то другое' }))).toBeNull();
    expect(adviceKey(e({ status: 'delivered', error: 'Мир сервера' }))).toBeNull();
  });
});

describe('how long the plugin took', () => {
  it('seconds with a tenth, null when unknown', () => {
    expect(tookSeconds(e({ deliveredAt: T0 + 1500 }))).toBe(1.5);
    expect(tookSeconds(e({ deliveredAt: null }))).toBeNull();
    expect(tookSeconds(e({ kind: 'restart', deliveredAt: T0 + 1000 }))).toBeNull();
  });
});

describe('what belongs together', () => {
  it('the other sends of a rule on the same server, not the entry itself', () => {
    const a = e({ kind: 'auto', by: 'авто: Тех.работы' });
    const all = [a, e({ kind: 'auto', by: 'авто: Тех.работы', ts: T0 - MIN }), e({ kind: 'auto', by: 'авто: Другое' }), e({ kind: 'auto', by: 'авто: Тех.работы', serverId: 2 })];
    expect(relatedOf(a, all)).toHaveLength(1);
  });
  it('the countdown messages of a restart around its start', () => {
    const r = e({ kind: 'restart', text: '10', status: 'done' });
    const all = [r, e({ kind: 'auto', by: 'авто: рестарт', ts: T0 + 2 * MIN }), e({ kind: 'auto', by: 'авто: рестарт', ts: T0 + 3 * 60 * MIN })];
    expect(relatedOf(r, all)).toHaveLength(1);
  });
});

describe('days', () => {
  it('cuts newest-first entries into local days', () => {
    const g = groupDays([e({ ts: T0 }), e({ ts: T0 - MIN }), e({ ts: T0 - 24 * 60 * MIN })]);
    expect(g.map((x) => x.items.length)).toEqual([2, 1]);
  });
});
