// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { LOOK_DEFAULT_KEY, LOOK_KEY, applyDefaultLook, getAppearance, initAppearance, setAppearance } from '../src/appearance';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-ember');
  initAppearance();
});

describe('the default look of the administrator', () => {
  it('applies while the visitor has not chosen a look', () => {
    applyDefaultLook('ember');
    expect(getAppearance().ember).toBe(true);
    expect(document.documentElement.getAttribute('data-ember')).toBe('1');
    expect(localStorage.getItem(LOOK_DEFAULT_KEY)).toBe('ember');
    applyDefaultLook('classic');
    expect(getAppearance().ember).toBe(false);
    expect(document.documentElement.hasAttribute('data-ember')).toBe(false);
  });

  it('does not override the own choice of the visitor', () => {
    setAppearance({ ember: false });
    expect(localStorage.getItem(LOOK_KEY)).toBe('0');
    applyDefaultLook('ember');
    expect(getAppearance().ember).toBe(false);
    setAppearance({ ember: true });
    applyDefaultLook('classic');
    expect(getAppearance().ember).toBe(true);
  });

  it('changing another option is not a choice of the look', () => {
    applyDefaultLook('ember');
    setAppearance({ largeText: true });
    expect(localStorage.getItem(LOOK_KEY)).toBeNull();
    applyDefaultLook('classic');
    expect(getAppearance().ember).toBe(false);
    expect(getAppearance().largeText).toBe(true);
  });
});
