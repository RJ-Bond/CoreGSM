import { describe, expect, it } from 'vitest';
import type { UpdateInfo } from '../api';
import { NO_UPDATE, shownUpdate, updateStateOf } from './updateState';

const base = { current: '1', latest: '2', available: true, checkedAt: 1, error: null, canApply: true, canRollback: false, pending: false, job: null } as UpdateInfo;

describe('update state of the badges', () => {
  it('an update waits', () => {
    const s = updateStateOf({ ...base, latestLabel: '1.1.43' });
    expect(s).toEqual({ available: true, running: false, progress: 0, version: '1.1.43' });
    expect(shownUpdate(s)).toBe(true);
  });
  it('a skipped version does not nag', () => {
    expect(shownUpdate(updateStateOf({ ...base, skipped: true }))).toBe(false);
  });
  it('the percent of a running update is kept in 0..100', () => {
    expect(updateStateOf({ ...base, job: { state: 'running', message: '', time: 1, progress: 48.4 } }).progress).toBe(48);
    expect(updateStateOf({ ...base, job: { state: 'running', message: '', time: 1, progress: 140 } }).progress).toBe(100);
    expect(updateStateOf({ ...base, job: { state: 'running', message: '' , time: 1 } }).progress).toBe(0);
  });
  it('a finished job shows no ring, nothing at all when up to date', () => {
    expect(updateStateOf({ ...base, available: false, job: { state: 'done', message: '', time: 1, progress: 100 } })).toEqual({ ...NO_UPDATE, version: '2' });
    expect(shownUpdate(NO_UPDATE)).toBe(false);
  });
  it('running keeps the badge even when nothing else is offered', () => {
    expect(shownUpdate(updateStateOf({ ...base, available: false, job: { state: 'running', message: '', time: 1, progress: 10 } }))).toBe(true);
  });
});
