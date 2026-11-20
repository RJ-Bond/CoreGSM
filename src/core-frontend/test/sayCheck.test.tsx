// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api', async (orig) => ({
  ...(await orig<typeof import('../src/api')>()),
  api: vi.fn(async () => ({
    checks: [
      { id: 'channel', ok: true, text: 'Бот слушает каналов: 1' },
      { id: 'bot', ok: false, text: 'Бот не вошёл в Discord: Включите Intents', fix: 'Включите Message Content Intent' },
      { id: 'writers', ok: null, text: 'Писать в игру могут администраторы' },
    ],
    attempts: [{ ts: Date.now(), name: 'RJ', status: 'denied', why: 'не администратор' }],
  })),
}));

const { SayCheck } = await import('../src/pages/GameNewsSayCheck');
afterEach(() => cleanup());

describe('the check of writing from Discord', () => {
  it('shows what is wrong and what to do, and the last attempts', async () => {
    render(<SayCheck />);
    fireEvent.click(screen.getByRole('button', { name: /Проверить запись из Discord|Check writing from Discord/ }));
    expect(await screen.findByText(/Бот не вошёл в Discord/)).toBeTruthy();
    expect(screen.getByText('Включите Message Content Intent')).toBeTruthy();
    expect(screen.getByText('не администратор')).toBeTruthy();
    expect(screen.getByText(/отклонена|refused/)).toBeTruthy();
  });
});
