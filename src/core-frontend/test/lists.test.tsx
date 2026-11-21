// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GroupedList, ListToolbar } from '../src/ui/lists';
import { Section } from '../src/ui';

interface Item { id: number; name: string }
const groups = [
  { id: 'a', title: 'Идёт сейчас', items: [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }] as Item[], tone: 'warn' as const },
  { id: 'b', title: 'Пусто', items: [] as Item[] },
  { id: 'c', title: 'Прошедшие', items: [{ id: 3, name: 'Old' }] as Item[], folded: true },
];
const view = () => render(<GroupedList storageKey="t" groups={groups} itemKey={(x) => x.id} render={(x) => <span>{x.name}</span>} />);

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => cleanup());

describe('a list in groups', () => {
  it('shows the groups that have items, with their counts; an empty group is not shown; a folded one is closed', () => {
    view();
    expect(screen.getByRole('button', { name: /Идёт сейчас/ }).textContent).toContain('2');
    expect(screen.queryByText('Пусто')).toBeNull();
    expect(screen.getByText('One')).toBeTruthy();
    expect(screen.queryByText('Old')).toBeNull();
  });
  it('opens and folds a group by a click and remembers it for the next visit', () => {
    const first = view();
    fireEvent.click(screen.getByRole('button', { name: /Прошедшие/ }));
    expect(screen.getByText('Old')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Идёт сейчас/ }));
    expect(screen.queryByText('One')).toBeNull();
    first.unmount();
    view();
    expect(screen.getByText('Old')).toBeTruthy();
    expect(screen.queryByText('One')).toBeNull();
  });
});

describe('the bar over a list', () => {
  it('searches and picks a state', () => {
    const seen: string[] = [];
    const states: string[] = [];
    render(<ListToolbar label="Список" search="" onSearch={(v) => seen.push(v)} placeholder="Поиск" states={[{ id: 'all', label: 'Все', count: 5 }, { id: 'on', label: 'Работают', count: 2 }]} value="all" onChange={(id) => states.push(id)} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'tex' } });
    fireEvent.click(screen.getByRole('button', { name: /Работают/ }));
    expect(seen).toEqual(['tex']);
    expect(states).toEqual(['on']);
  });
});

describe('a card with zones', () => {
  it('keeps the advanced part folded and shows the danger zone with its title', () => {
    render(<Section title="Бот" advanced={<p>Редкое поле</p>} danger={<button type="button">Удалить токен</button>}>Главное</Section>);
    expect(screen.getByText('Главное')).toBeTruthy();
    expect((screen.getByText(/Дополнительно|Advanced/).closest('details') as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByRole('group', { name: /Опасная зона|Danger zone/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Удалить токен' })).toBeTruthy();
  });
});
