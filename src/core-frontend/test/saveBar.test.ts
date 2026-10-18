import { describe, expect, it } from 'vitest';
import { needsBar, summarize } from '../src/saveBarLogic';

describe('save bar', () => {
  it('a form needs the bar when it has an edit, a refused edit or a failed save', () => {
    expect(['idle', 'saved', 'saving'].some((s) => needsBar(s as never))).toBe(false);
    expect(['dirty', 'invalid', 'error'].every((s) => needsBar(s as never))).toBe(true);
  });
  it('is hidden while nothing is edited', () => {
    expect(summarize({}).show).toBe(false);
    expect(summarize({ a: { label: 'A', status: 'idle' }, b: { label: 'B', status: 'saved' } }).show).toBe(false);
  });
  it('names the edited forms and saves only the valid ones', () => {
    const s = summarize({ brand: { label: 'оформление', status: 'dirty' }, poll: { label: 'опрос серверов', status: 'idle' }, rules: { label: 'правила', status: 'dirty' } });
    expect(s.show).toBe(true);
    expect(s.saveIds).toEqual(['brand', 'rules']);
    expect(s.blocked).toBe(false);
    expect(s.text).toBe('Есть несохранённые изменения: оформление, правила');
  });
  it('an invalid form blocks «Сохранить» and is not sent', () => {
    const s = summarize({ brand: { label: 'оформление', status: 'invalid' }, poll: { label: 'опрос', status: 'dirty' } });
    expect(s.blocked).toBe(true);
    expect(s.saveIds).toEqual(['poll']);
  });
  it('a failed save is the headline and can be retried', () => {
    const s = summarize({ brand: { label: 'оформление', status: 'error' } });
    expect(s.failed).toBe(true);
    expect(s.text).toBe('Не сохранено: оформление');
    expect(s.saveIds).toEqual(['brand']);
  });
  it('shows «Сохраняется…» while a request runs even when nothing else is edited', () => {
    const s = summarize({ brand: { label: 'оформление', status: 'saving' } });
    expect(s.show).toBe(true);
    expect(s.saving).toBe(true);
    expect(s.text).toBe('Сохраняется…');
  });
});
