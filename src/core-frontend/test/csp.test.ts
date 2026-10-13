import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * nginx.conf allows the single inline script of index.html by its sha256. If that script is edited and the hash is not
 * updated, the browser blocks it (the saved theme would flash). This test fails first.
 */
describe('content security policy', () => {
  it('allows exactly the inline scripts of index.html', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const conf = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8');
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '');
    expect(inline.length).toBeGreaterThan(0);
    for (const body of inline) {
      const hash = `sha256-${createHash('sha256').update(body).digest('base64')}`;
      expect(conf, `nginx.conf must contain ${hash}`).toContain(hash);
    }
  });
});
