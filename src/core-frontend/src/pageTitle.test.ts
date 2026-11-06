import { describe, expect, it } from 'vitest';
import { tabTitle } from './pageTitle';

describe('tabTitle', () => {
  it('joins the section, the detail and the brand, skipping what is empty', () => {
    expect(tabTitle('Серверы', 'Rust | Vanilla', 'CoreGSM')).toBe('Серверы · Rust | Vanilla · CoreGSM');
    expect(tabTitle('Серверы', null, 'CoreGSM')).toBe('Серверы · CoreGSM');
    expect(tabTitle('', null, 'CoreGSM')).toBe('CoreGSM');
  });
});
