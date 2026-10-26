import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api';
import { errText } from '../src/ui/action';
import { t } from '../src/i18n';

describe('errText', () => {
  it('takes the message of an Error and of an ApiError', () => {
    expect(errText(new Error('boom'))).toBe('boom');
    expect(errText(new ApiError('Неверный пароль', 401))).toBe('Неверный пароль');
  });
  it('accepts a plain string', () => {
    expect(errText('  oops ')).toBe('oops');
  });
  it('falls back for anything without a message', () => {
    expect(errText(undefined)).toBe(t('common.error'));
    expect(errText(new Error('  '))).toBe(t('common.error'));
    expect(errText({})).toBe(t('common.error'));
    expect(errText(null, 'custom')).toBe('custom');
  });
});
