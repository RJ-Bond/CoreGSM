#!/usr/bin/env node
// The speed audit of the BUILT panel with Lighthouse (the real numbers of the visitors are in «Система → Скорость у посетителей»).
//   cd src/core-frontend && npm run build   # first: the audit looks at dist/, not at the dev server
//   node tools/lighthouse/run.mjs [--pages=servers,server,status,news,login] [--out=lighthouse-out] [--min-perf=0]
// Starts a demo backend on a database of its own, seeds it (tools/shots/seed.mjs), serves dist/ with `vite preview` and runs
// Lighthouse (a pinned version, through npx) on each page. Prints a table; fails only when a score is below --min-perf (default: never).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed } from '../shots/seed.mjs';

const LIGHTHOUSE = 'lighthouse@13.5.0';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const opts = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a); if (!m) throw new Error(`Unknown argument: ${a}`); return [m[1], m[2] ?? true]; }));
const PAGES = { servers: '/servers', server: '/servers/1', status: '/status', news: '/news', community: '/community', login: '/login' };
const want = String(opts.pages ?? 'servers,server,status,login').split(',').filter(Boolean);
for (const w of want) if (!PAGES[w]) { console.error(`Unknown page "${w}" (${Object.keys(PAGES).join(', ')})`); process.exit(2); }
const outDir = path.resolve(String(opts.out ?? 'lighthouse-out'));
const minPerf = Number(opts['min-perf'] ?? 0);

const children = [];
const kill = (c) => { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); else c.kill('SIGKILL'); } catch { /* gone */ } };
const cleanup = () => { for (const c of children.splice(0)) kill(c); };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); s.on('error', reject); });
const waitHttp = async (url, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not yet */ } await sleep(400); } throw new Error(`Nothing answers at ${url}`); };

if (!fs.existsSync(path.join(root, 'src/core-frontend/dist/index.html'))) { console.error('The panel is not built: run `npm run build` in src/core-frontend first.'); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-lh-'));
const bp = await freePort();
const fp = await freePort();
const backend = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: path.join(root, 'src/core-backend'), stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'test', PORT: String(bp), DB_PATH: path.join(tmp, 'coregsm.db'), JWT_SECRET: 'j'.repeat(40), INTERNAL_TOKEN: 'i'.repeat(48), SETUP_TOKEN: 'seed-code', POLL_INTERVAL_SEC: '3600' },
});
children.push(backend);
let log = '';
backend.stdout.on('data', (d) => { log += d; });
backend.stderr.on('data', (d) => { log += d; });
await waitHttp(`http://127.0.0.1:${bp}/api/setup/status`).catch((e) => { throw new Error(`${e.message}\n${log.slice(-1500)}`); });
await seed({ base: `http://127.0.0.1:${bp}`, dbPath: path.join(tmp, 'coregsm.db') });

const viteBin = path.join(root, 'src/core-frontend/node_modules/vite/bin/vite.js');
const preview = spawn(process.execPath, [viteBin, 'preview', '--port', String(fp), '--strictPort', '--host', '127.0.0.1'], {
  cwd: path.join(root, 'src/core-frontend'), stdio: 'ignore', env: { ...process.env, COREGSM_API: `http://127.0.0.1:${bp}` },
});
children.push(preview);
await waitHttp(`http://127.0.0.1:${fp}/`);

fs.mkdirSync(outDir, { recursive: true });
const rows = [];
for (const name of want) {
  const file = path.join(outDir, `${name}.json`);
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', LIGHTHOUSE, `http://127.0.0.1:${fp}${PAGES[name]}`, '--quiet', '--output=json', `--output-path=${file}`,
    '--only-categories=performance,accessibility,best-practices,seo', '--chrome-flags=--headless=new --no-sandbox --disable-gpu'], { encoding: 'utf8', shell: process.platform === 'win32', env: process.env });
  if (r.status !== 0 || !fs.existsSync(file)) { rows.push({ name, error: (r.stderr || r.stdout || 'no result').slice(-400) }); continue; }
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const score = (k) => Math.round((j.categories[k]?.score ?? 0) * 100);
  const a = j.audits;
  rows.push({
    name, perf: score('performance'), a11y: score('accessibility'), bp: score('best-practices'), seo: score('seo'),
    lcp: a['largest-contentful-paint']?.numericValue, tbt: a['total-blocking-time']?.numericValue, cls: a['cumulative-layout-shift']?.numericValue, bytes: a['total-byte-weight']?.numericValue,
  });
}

const ms = (v) => (v == null ? '–' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const lines = [`# Lighthouse (${LIGHTHOUSE}, the built panel, a slow mobile profile of Lighthouse)`, '', '| page | performance | accessibility | best practices | SEO | LCP | TBT | CLS | weight |', '|---|---|---|---|---|---|---|---|---|'];
for (const r of rows) lines.push(r.error ? `| ${r.name} | failed: ${String(r.error).replace(/\s+/g, ' ').slice(0, 120)} | | | | | | | |` : `| ${r.name} | ${r.perf} | ${r.a11y} | ${r.bp} | ${r.seo} | ${ms(r.lcp)} | ${ms(r.tbt)} | ${(r.cls ?? 0).toFixed(3)} | ${r.bytes ? `${Math.round(r.bytes / 1024)} KB` : '–'} |`);
const text = lines.join('\n') + '\n';
fs.writeFileSync(path.join(outDir, 'report.md'), text);
console.log(text);
cleanup();
const bad = rows.filter((r) => r.error || (minPerf > 0 && r.perf < minPerf));
process.exit(bad.length ? 1 : 0);
