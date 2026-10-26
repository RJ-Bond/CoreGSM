import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { noteTone, NOTES_SHOWN, RESOLVED_KEEP_MS, visibleNotes } from '../src/statusNotesLogic.js';

const NOW = 1_000_000_000_000;
const n = (id: number, level: 'info' | 'warn' | 'bad' | 'ok', created: number, resolved: number | null = null) => ({ id, level, created_at: created, resolved_at: resolved });

describe('status notes: what the public page shows', () => {
  it('open notes first: serious before calm, then the newest', () => {
    const out = visibleNotes([n(1, 'info', 3), n(2, 'bad', 1), n(3, 'warn', 2), n(4, 'info', 5)], NOW);
    assert.deepEqual(out.map((x) => x.id), [2, 3, 4, 1]);
  });
  it('closed notes follow, newest closing first, and disappear after two weeks', () => {
    const out = visibleNotes([n(1, 'bad', 1, NOW - 1000), n(2, 'info', 2, NOW - 5000), n(3, 'bad', 3, NOW - RESOLVED_KEEP_MS - 1), n(4, 'warn', 4)], NOW);
    assert.deepEqual(out.map((x) => x.id), [4, 1, 2]);
  });
  it('never more than the limit', () => {
    const many = Array.from({ length: NOTES_SHOWN + 10 }, (_, i) => n(i, 'info', i));
    assert.equal(visibleNotes(many, NOW).length, NOTES_SHOWN);
  });
  it('a resolved note is always calm', () => {
    assert.equal(noteTone('bad', true), 'ok');
    assert.equal(noteTone('bad', false), 'bad');
  });
});
