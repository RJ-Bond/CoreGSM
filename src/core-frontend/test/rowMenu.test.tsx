// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import RowMenu from '../src/components/RowMenu';

afterEach(() => cleanup());

const open = (rect: { left: number; right: number; top: number; bottom: number }) => {
  window.innerWidth = 400;
  window.innerHeight = 800;
  render(<RowMenu label="Меню" items={[{ key: 'a', label: 'Запустить' }, { key: 'b', label: 'Удалить', danger: true }]} />);
  const btn = screen.getByRole('button', { name: 'Меню' });
  btn.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top, x: rect.left, y: rect.top, toJSON: () => ({}) });
  fireEvent.click(btn);
  return screen.getByRole('menu') as HTMLElement;
};

describe('the «⋯» menu of a row', () => {
  it('hangs from the right edge of the button when there is room to the left', () => {
    const menu = open({ left: 340, right: 380, top: 100, bottom: 130 });
    expect(menu.style.right).toBe('20px');
    expect(menu.style.left).toBe('');
  });

  it('starts at the button when it sits near the left edge (a wrapped card on a phone), so the screen does not cut it off', () => {
    const menu = open({ left: 20, right: 60, top: 100, bottom: 130 });
    expect(menu.style.left).toBe('20px');
    expect(menu.style.right).toBe('');
  });

  it('opens upwards when there is no room under the button', () => {
    const menu = open({ left: 340, right: 380, top: 700, bottom: 730 });
    expect(menu.style.bottom).not.toBe('');
    expect(menu.style.top).toBe('');
  });

  it('does an item by its key while the menu is open, and shows the key', () => {
    const done: string[] = [];
    window.innerWidth = 400;
    render(<RowMenu label="Меню" items={[{ key: 'e', label: 'Изменить', shortcut: 'e', onSelect: () => done.push('edit') }, { key: 'x', label: 'Удалить', shortcut: 'Delete', onSelect: () => done.push('del') }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Меню' }));
    expect(screen.getByText('E')).toBeTruthy();
    expect(screen.getByText('Del')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'e' });
    expect(done).toEqual(['edit']);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
