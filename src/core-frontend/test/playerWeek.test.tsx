// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import PlayerWeekCard from '../src/components/PlayerWeekCard';
import { weekOf } from '../src/pages/playerWeek';

afterEach(cleanup);
const NOW = Date.parse('2026-03-20T12:00:00Z');
const days = (secs: number[]) => secs.map((seconds, i) => ({ date: new Date(NOW - (secs.length - 1 - i) * 86_400_000).toISOString().slice(0, 10), seconds }));

describe('the week of a player', () => {
  it('compares the last seven days with the seven before and finds the best day', () => {
    const w = weekOf(days([3600, 0, 0, 0, 0, 0, 0, 7200, 0, 3600, 30, 10800, 0, 0]), [{ earned: true, earnedAt: NOW - 86_400_000 }, { earned: true, earnedAt: NOW - 30 * 86_400_000 }, { earned: false }], NOW)!;
    expect(w.hours).toBe(6);
    expect(w.before).toBe(1);
    expect(w.days).toBe(3);
    expect(w.best?.hours).toBe(3);
    expect(w.achievements).toBe(1);
    expect(w.bars.length).toBe(7);
  });
  it('says nothing about somebody who has not played for two weeks', () => {
    expect(weekOf(days([...Array(14).fill(0)]))).toBeNull();
    expect(weekOf([])).toBeNull();
  });
  it('shows the figures and a line to copy', () => {
    render(<PlayerWeekCard name="Kira" byDay={days([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7200])} />);
    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.getByRole('img')).toBeTruthy();
  });
  it('draws nothing without games', () => {
    const { container } = render(<PlayerWeekCard name="Kira" byDay={[]} />);
    expect(container.textContent).toBe('');
  });
});
