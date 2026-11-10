// A budget for the weight of the panel: what a first visit downloads (the files named in dist/index.html, gzipped)
// and the biggest single chunk of a page. A change that makes the panel heavier fails here, not on a phone.
//   node scripts/bundle-budget.mjs            after `npm run build`
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dist = path.resolve(process.argv[2] ?? 'dist');
const BUDGET_INITIAL_KB = Number(process.env.BUDGET_INITIAL_KB ?? 470);
const BUDGET_CHUNK_KB = Number(process.env.BUDGET_CHUNK_KB ?? 170);

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const files = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))];
const gz = (f) => zlib.gzipSync(fs.readFileSync(path.join(dist, f))).length;

const initial = files.map((f) => ({ f, kb: gz(f) / 1024 }));
const initialKb = initial.reduce((n, x) => n + x.kb, 0);
const chunks = fs.readdirSync(path.join(dist, 'assets')).filter((f) => /\.js$/.test(f)).map((f) => ({ f, kb: gz(path.join('assets', f)) / 1024 })).sort((a, b) => b.kb - a.kb);

console.log(`first visit: ${initialKb.toFixed(0)} KB gzip in ${files.length} files (budget ${BUDGET_INITIAL_KB} KB)`);
for (const x of initial.sort((a, b) => b.kb - a.kb).slice(0, 4)) console.log(`  ${x.f.replace('/assets/', '').padEnd(34)} ${x.kb.toFixed(0)} KB`);
console.log(`the biggest chunk: ${chunks[0].f} ${chunks[0].kb.toFixed(0)} KB (budget ${BUDGET_CHUNK_KB} KB)`);

let bad = 0;
if (initialKb > BUDGET_INITIAL_KB) { console.error(`::error title=bundle budget::the first visit weighs ${initialKb.toFixed(0)} KB gzip, the budget is ${BUDGET_INITIAL_KB} KB`); bad++; }
const over = chunks.filter((c) => c.kb > BUDGET_CHUNK_KB);
if (over.length) { console.error(`::error title=bundle budget::chunks over ${BUDGET_CHUNK_KB} KB gzip: ${over.map((c) => `${c.f} ${c.kb.toFixed(0)} KB`).join(', ')}`); bad++; }
process.exit(bad ? 1 : 0);
