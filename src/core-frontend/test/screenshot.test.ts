import { describe, expect, it } from 'vitest';
import { shotFileName, wasCancelled } from '../src/screenshot';

describe('screenshot', () => {
  const d = new Date(2026, 9, 26, 10, 35, 7);
  it('names the file after the page and the time', () => {
    expect(shotFileName('/admin/settings/updates', d)).toBe('coregsm-admin-settings-updates-20261026-103507.png');
    expect(shotFileName('/servers/12?tab=players#x', d)).toBe('coregsm-servers-12-20261026-103507.png');
    expect(shotFileName('/', d)).toBe('coregsm-home-20261026-103507.png');
  });
  it('treats a refused permission as a cancel, other errors as errors', () => {
    expect(wasCancelled(new DOMException('no', 'NotAllowedError'))).toBe(true);
    expect(wasCancelled(new DOMException('no', 'AbortError'))).toBe(true);
    expect(wasCancelled(new Error('x'))).toBe(false);
  });
});
