#!/usr/bin/env node
// Copies src/shared/types/*.ts into both packages (see src/shared/README.md).
//   node tools/sync-shared.mjs           writes the copies
//   node tools/sync-shared.mjs --check   exits 1 when a copy is missing or differs (CI, the backend test)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src/shared/types');
const TARGETS = ['src/core-backend/src/shared', 'src/core-frontend/src/shared'];

/** the text of a copy: a notice, then the original as it is */
export const copyOf = (name, text) => `// GENERATED from src/shared/types/${name} by tools/sync-shared.mjs: do not edit here.\n${text}`;

/** the copies that are missing or differ: [path of the copy, ...] */
export function stale() {
  const out = [];
  for (const name of fs.readdirSync(SRC).filter((n) => n.endsWith('.ts'))) {
    const want = copyOf(name, fs.readFileSync(path.join(SRC, name), 'utf8'));
    for (const dir of TARGETS) {
      const file = path.join(root, dir, name);
      let have = null;
      try { have = fs.readFileSync(file, 'utf8'); } catch { /* missing */ }
      if (have !== want) out.push(path.relative(root, file).split(path.sep).join('/'));
    }
  }
  return out;
}

export function write() {
  for (const name of fs.readdirSync(SRC).filter((n) => n.endsWith('.ts'))) {
    const text = copyOf(name, fs.readFileSync(path.join(SRC, name), 'utf8'));
    for (const dir of TARGETS) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      fs.writeFileSync(path.join(root, dir, name), text);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const bad = stale();
    if (bad.length) { console.error(`::error title=shared types::out of date: ${bad.join(', ')}. Run node tools/sync-shared.mjs`); process.exit(1); }
    console.log('shared types: the copies match');
  } else {
    write();
    console.log('shared types: copied');
  }
}
