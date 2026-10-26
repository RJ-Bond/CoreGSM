import { describe, expect, it } from 'vitest';
import { channelState, channelTarget } from '../src/components/AlertChannels';
import { ruleText, validatePoll } from '../src/pollSettings';

describe('alert channels', () => {
  it('shows where a channel goes without the secret part of an address', () => {
    expect(channelTarget({ kind: 'webhook', urlPreview: 'https://hooks.example.com/…', recipients: [] })).toBe('https://hooks.example.com/…');
    expect(channelTarget({ kind: 'email', urlPreview: '', recipients: ['a@x.ru', 'b@x.ru'] })).toBe('a@x.ru, b@x.ru');
  });
  it('describes the last delivery', () => {
    expect(channelState({ enabled: false, lastStatus: 'ok', lastError: null, lastAt: 1 })).toEqual({ text: 'выключен', tone: 'mute' });
    expect(channelState({ enabled: true, lastStatus: null, lastError: null, lastAt: null }).tone).toBe('mute');
    expect(channelState({ enabled: true, lastStatus: 'ok', lastError: null, lastAt: Date.now() }).tone).toBe('ok');
    const bad = channelState({ enabled: true, lastStatus: 'error', lastError: 'Получатель ответил ошибкой 500', lastAt: Date.now() });
    expect(bad.tone).toBe('bad');
    expect(bad.text).toContain('ошибкой 500');
  });
});

describe('rule «N of M»', () => {
  it('empty fields are valid; numbers must be 1..20', () => {
    expect(validatePoll({ failThreshold: 2, concurrency: 8, failN: null, failM: null })).toBeNull();
    expect(validatePoll({ failThreshold: 2, concurrency: 8, failN: 3, failM: 5 })).toBeNull();
    expect(validatePoll({ failThreshold: 2, concurrency: 8, failN: 0, failM: 5 })).not.toBeNull();
    expect(validatePoll({ failThreshold: 2, concurrency: 8, failN: 3, failM: 21 })).not.toBeNull();
    expect(validatePoll({ failThreshold: 2, concurrency: 8, failN: 1.5, failM: null })).not.toBeNull();
    expect(validatePoll({ failThreshold: 2, concurrency: 8, failN: Number.NaN, failM: null })).not.toBeNull();
  });
  it('explains the rule in force like the server does', () => {
    expect(ruleText(null, null, 2)).toContain('2 неудачных опросов подряд');
    expect(ruleText(3, 5, 2)).toContain('3 из последних 5');
    expect(ruleText(9, 4, 2)).toContain('4 из последних 4');
    expect(ruleText(4, null, 2)).toContain('4 из последних 4');
    expect(ruleText(null, 5, 2)).toContain('2 из последних 5');
  });
});
