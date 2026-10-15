import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { errorText, localizeError } from '../src/apiErrors';
import { applyServerPrefs } from '../src/i18n';
import errorsEn from '../src/locales/errors.en';

// the codes and Russian texts of the backend's catalogue
const backend = readFileSync(new URL('../../core-backend/src/errors.ts', import.meta.url), 'utf8');
const catalogue = Object.fromEntries([...backend.matchAll(/^ {2}([a-z][a-z0-9_]*): '((?:\\'|[^'])*)',$/gm)].map((m) => [m[1], m[2]]));
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('API error texts', () => {
  afterEach(() => applyServerPrefs({ lang: 'ru' }));

  it('every backend code has an English text with the same placeholders, and nothing else', () => {
    expect(Object.keys(catalogue).length).toBeGreaterThan(100);
    expect(Object.keys(errorsEn).sort()).toEqual(Object.keys(catalogue).sort());
    for (const [code, ru] of Object.entries(catalogue)) expect(holes(errorsEn[code]), code).toEqual(holes(ru));
  });

  it('English is taken by the code, with the values filled in', () => {
    applyServerPrefs({ lang: 'en' });
    expect(localizeError({ error: 'Требуется вход', code: 'auth_required' })).toBe('Sign-in required');
    expect(localizeError({ error: '…', code: 'login_locked', params: { sec: '42' } })).toBe('Too many wrong attempts. Try again in 42 s.');
  });

  it('Russian is the server text; an unknown code or no code falls back to it', () => {
    expect(localizeError({ error: 'Требуется вход', code: 'auth_required' })).toBe('Требуется вход');
    applyServerPrefs({ lang: 'en' });
    expect(localizeError({ error: 'Новый текст', code: 'added_later' })).toBe('Новый текст');
    expect(localizeError({ error: 'Без кода' })).toBe('Без кода');
    expect(localizeError(null)).toBeNull();
    expect(errorText({}, 'fallback')).toBe('fallback');
  });
});
