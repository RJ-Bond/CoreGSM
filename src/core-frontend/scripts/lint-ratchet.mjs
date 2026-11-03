// Lint "ratchet": oxlint still reports old findings (the static a11y rules flag patterns that axe accepts), so the
// check does not demand zero. It fails when any rule reports MORE findings than lint-baseline.json allows, so the
// number can only go down. After fixing findings run `npm run lint:ratchet -- --update` and commit the new baseline.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = new URL('../lint-baseline.json', import.meta.url);
const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let out;
try {
  out = execFileSync(bin, ['oxlint', '-f', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' });
} catch (e) {
  out = e.stdout; // oxlint exits non-zero when it has findings
  if (!out) throw e;
}
const counts = {};
for (const d of JSON.parse(out).diagnostics) counts[d.code] = (counts[d.code] || 0) + 1;
const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));

if (process.argv.includes('--update')) {
  writeFileSync(BASE, JSON.stringify(sorted, null, 2) + '\n');
  console.log('lint baseline updated:', Object.values(sorted).reduce((a, b) => a + b, 0), 'findings');
  process.exit(0);
}

const base = JSON.parse(readFileSync(BASE, 'utf8'));
const worse = Object.entries(sorted).filter(([k, n]) => n > (base[k] || 0));
const better = Object.entries(base).filter(([k, n]) => (sorted[k] || 0) < n);
for (const [k, n] of worse) console.error(`::error title=oxlint::${k}: ${n} findings, the baseline allows ${base[k] || 0}`);
if (worse.length) process.exit(1);
if (better.length) console.log(`Fewer findings than the baseline for ${better.length} rule(s): run "npm run lint:ratchet -- --update" and commit lint-baseline.json`);
console.log('lint ratchet ok:', Object.values(sorted).reduce((a, b) => a + b, 0), 'findings');
