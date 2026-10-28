import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards against new bare Cyrillic in JSX (text nodes and common attributes) outside t().
// Files below still hold old debt; the numbers may only go down.
const SRC = fileURLToPath(new URL('../src', import.meta.url));
const CYR = /[А-Яа-яЁё]/;
const ATTR = /\b(?:title|aria-label|aria-description|placeholder|label|hint|alt|help|subtitle|text|confirmLabel)=(?:"[^"]*[А-Яа-яЁё][^"]*"|'[^']*[А-Яа-яЁё][^']*')/;

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function bareLines(src: string): number {
  let n = 0;
  let inBlock = false;
  for (const raw of src.split('\n')) {
    let line = raw;
    if (inBlock) { if (line.includes('*/')) { inBlock = false; line = line.slice(line.indexOf('*/') + 2); } else continue; }
    line = line.replace(/\/\*.*?\*\//g, '');
    if (line.includes('/*')) { inBlock = true; line = line.slice(0, line.indexOf('/*')); }
    line = line.replace(/\{\/\*.*?\*\/\}/g, '').replace(/^\s*\/\/.*$/, '');
    if (!CYR.test(line)) continue;
    if (ATTR.test(line)) { n++; continue; }
    // JSX text: Cyrillic between > and < on one line, or a bare text line (no code punctuation at start)
    if (/>[^<>{}]*[А-Яа-яЁё][^<>{}]*</.test(line) || /^\s*[А-Яа-яЁё][^`'"=;(){}]*$/.test(line)) n++;
  }
  return n;
}

// file (relative to src) -> allowed count of lines with bare Cyrillic. Can only shrink.
const DEBT: Record<string, number> = {
  'components/Illustrations.tsx': 6,
  'components/server/PlayersList.tsx': 18,
  'pages/Cards.tsx': 9,
  'pages/UiKit.tsx': 138,
};

describe('no bare Cyrillic in JSX outside t()', () => {
  it('stays within the allowed debt', () => {
    const over: string[] = [];
    const under: string[] = [];
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f).split('\\').join('/');
      const n = bareLines(readFileSync(f, 'utf8'));
      const allowed = DEBT[rel] ?? 0;
      if (n > allowed) over.push(`${rel}: ${n} (allowed ${allowed})`);
      if (n < allowed) under.push(`${rel}: ${n} (allowed ${allowed}), lower the number`);
    }
    expect(over, 'wrap new texts in t() and add keys to locales/ru.ts and en.ts').toEqual([]);
    expect(under).toEqual([]);
  });
});
