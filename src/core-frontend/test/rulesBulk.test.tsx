// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GameNewsRules from '../src/pages/GameNewsRules';
import { emptyRule, type RuleInfo } from '../src/gameNews';
import { t } from '../src/i18n';

const calls: [string, string?, unknown?][] = [];
vi.mock('../src/api', async (orig) => ({
  ...(await orig<typeof import('../src/api')>()),
  api: vi.fn(async (path: string, method?: string, body?: unknown) => { calls.push([path, method, body]); return {}; }),
}));

afterEach(() => { cleanup(); calls.length = 0; localStorage.clear(); });

const rule = (id: number, enabled: boolean): RuleInfo => ({ ...emptyRule(), id, name: `Rule ${id}`, text: 'hello', enabled, expired: false, lastRun: null, nextRun: null, createdBy: 'a', upcoming: [] } as unknown as RuleInfo);

describe('several auto announcements at once', () => {
  it('switches off only the ones that are on', async () => {
    const reload = vi.fn();
    render(<GameNewsRules servers={[]} rules={[rule(1, true), rule(2, true), rule(3, false)]} timezone="UTC" reload={reload} />);
    fireEvent.click(screen.getByLabelText(t('gn.a.bulk.all')));
    fireEvent.click(screen.getByRole('button', { name: t('gn.a.bulk.off') }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(calls.map((c) => [c[0], c[1]])).toEqual([['/game-news/rules/1', 'PUT'], ['/game-news/rules/2', 'PUT']]);
    expect((calls[0][2] as { enabled: boolean }).enabled).toBe(false);
  });
  it('shows no ticks for a single rule', () => {
    render(<GameNewsRules servers={[]} rules={[rule(1, true)]} timezone="UTC" reload={() => undefined} />);
    expect(screen.queryByRole('checkbox', { name: t('gn.a.bulk.one', { name: 'Rule 1' }) })).toBeNull();
  });
});
