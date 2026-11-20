// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('../src/api', async (orig) => ({
  ...(await orig<typeof import('../src/api')>()),
  api: vi.fn(async (path: string) => { calls.push(path); return { ok: true }; }),
}));

const { RuleModal } = await import('../src/pages/GameNewsRules');
const { emptyRule } = await import('../src/gameNews');

afterEach(() => { cleanup(); calls.length = 0; });

describe('the form of an auto announcement', () => {
  it('says what is missing when «Сохранить» is pressed without a name, and does not send anything', () => {
    render(<RuleModal id={null} initial={{ ...emptyRule(), text: 'Привет' }} servers={[]} timezone="UTC" onClose={() => undefined} onSaved={() => undefined} />);
    const save = screen.getByRole('button', { name: /^(Сохранить|Save)$/ });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    expect(screen.getByRole('alert').textContent).toMatch(/название|name/i);
    expect(calls).not.toContain('/game-news/rules');
  });

  it('sends the rule once it is complete', async () => {
    render(<RuleModal id={null} initial={{ ...emptyRule(), name: 'Тех.работы', text: 'Привет' }} servers={[]} timezone="UTC" onClose={() => undefined} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /^(Сохранить|Save)$/ }));
    await vi.waitFor(() => expect(calls).toContain('/game-news/rules'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
