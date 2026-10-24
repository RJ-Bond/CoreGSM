// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '../src/components/Button';
import { RootBoundary } from '../src/RootBoundary';
import { ago } from '../src/ui/format';

afterEach(cleanup);

function Boom(): never {
  throw new Error('kaboom');
}

describe('RootBoundary', () => {
  it('shows the crash screen with the details instead of a white page', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<RootBoundary><Boom /></RootBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('kaboom');
    expect(screen.getAllByRole('button').length).toBe(2);
    spy.mockRestore();
  });

  it('renders the children when nothing fails', () => {
    render(<RootBoundary><p>fine</p></RootBoundary>);
    expect(screen.getByText('fine')).toBeTruthy();
  });
});

describe('Button', () => {
  it('is disabled and announces busy while loading', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const b = screen.getByRole('button') as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('clicks when idle and keeps the variant class', () => {
    const onClick = vi.fn();
    render(<Button variant="outline" onClick={onClick}>Go</Button>);
    const b = screen.getByRole('button');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(b.className).toContain('btn-outline');
  });
});

describe('ago', () => {
  it('says "just now" for the first seconds, then counts', () => {
    expect(ago(Date.now() - 2000)).toMatch(/только что|just now/);
    expect(ago(Date.now() - 30_000)).toMatch(/30|31|29/);
    expect(ago(null)).toBe('–');
  });
});
