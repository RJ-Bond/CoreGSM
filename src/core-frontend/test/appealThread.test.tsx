// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppealThread from '../src/components/AppealThread';

const sent: unknown[] = [];
let canReply = true;
vi.mock('../src/api', async (orig) => ({
  ...(await orig<typeof import('../src/api')>()),
  api: vi.fn(async (path: string, method?: string, body?: unknown) => {
    if (method === 'POST') { sent.push(body); return { id: 9 }; }
    return {
      appeal: { id: 5, nick: 'Talker', status: canReply ? 'open' : 'rejected', canReply },
      messages: [
        { id: 1, at: 1_700_000_000_000, side: 'staff', author: 'mod', text: 'Which server?' },
        { id: 2, at: 1_700_000_100_000, side: 'player', author: 'talker', text: 'The second one.' },
      ],
    };
  }),
}));

afterEach(() => { cleanup(); sent.length = 0; canReply = true; });

describe('the conversation under an appeal', () => {
  it('shows both sides and sends a reply', async () => {
    render(<AppealThread id={5} />);
    expect(await screen.findByText('Which server?')).toBeTruthy();
    expect(screen.getByText('The second one.')).toBeTruthy();
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: '  thanks  ' } });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(sent).toEqual([{ text: 'thanks' }]));
  });
  it('has no form once the appeal is decided', async () => {
    canReply = false;
    render(<AppealThread id={5} />);
    await screen.findByText('Which server?');
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
