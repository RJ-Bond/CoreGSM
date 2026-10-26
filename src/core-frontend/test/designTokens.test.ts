import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The panel's small text sizes and rounded corners come from tokens (index.css: --fs-*, --r-*), not from numbers
// written where they are used. Large display sizes (over 18px) are free.
const SRC = fileURLToPath(new URL('../src', import.meta.url));
const walk = (dir: string, ext: string[], out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (ext.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
};
const rel = (f: string) => relative(SRC, f).split('\\').join('/');

describe('design tokens', () => {
  it('has no px font-size up to 18px in the stylesheets', () => {
    const bad: string[] = [];
    for (const f of walk(SRC, ['.css'])) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) if (Number(m[1]) <= 18) bad.push(`${rel(f)}: ${m[0]}`);
    }
    expect(bad, 'use var(--fs-2xs|xs|sm|md|base|lg|xl)').toEqual([]);
  });
  it('has no text-[Npx] up to 18px in the components', () => {
    const bad: string[] = [];
    for (const f of walk(SRC, ['.tsx'])) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) if (Number(m[1]) <= 18) bad.push(`${rel(f)}: ${m[0]}`);
    }
    expect(bad, 'use text-fs-2xs|xs|sm|md|base|lg|xl').toEqual([]);
  });
  it('rounds corners with the radius scale', () => {
    const bad: string[] = [];
    for (const f of walk(SRC, ['.tsx'])) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/rounded-\[(\d+)px\]/g)) if (Number(m[1]) >= 9) bad.push(`${rel(f)}: ${m[0]}`);
    }
    expect(bad, 'use rounded-ui-sm|md|lg|xl').toEqual([]);
  });
  it('defines every token the scale names', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    for (const k of ['2xs', 'xs', 'sm', 'md', 'base', 'lg', 'xl']) {
      expect(css).toContain(`--fs-${k}:`);
      expect(css).toContain(`--text-fs-${k}:`);
    }
  });
});
