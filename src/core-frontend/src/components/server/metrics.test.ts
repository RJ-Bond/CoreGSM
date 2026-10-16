import { describe, expect, it } from 'vitest';
import { uptimeLevel } from './Metrics';

describe('uptime colour', () => {
  it('green from 99 %, amber from 95 %, red below, nothing without data', () => {
    expect(uptimeLevel(100)).toBe('good');
    expect(uptimeLevel(99)).toBe('good');
    expect(uptimeLevel(97.9)).toBe('warm');
    expect(uptimeLevel(95)).toBe('warm');
    expect(uptimeLevel(94.9)).toBe('hot');
    expect(uptimeLevel(null)).toBeUndefined();
  });
});
