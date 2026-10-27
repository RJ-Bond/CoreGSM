#!/usr/bin/env node
// The local development stand WITHOUT Docker: the backend and vite run straight from the folders of the panel, on this
// computer. The code is taken from src/ as it is, so every change shows at once (vite reloads the page, the backend
// starts again by itself). The data is in tools/dev/.data (it is not committed).
//   node tools/dev/local.mjs            start (and put the demo data in on the first run)
//   node tools/dev/local.mjs reset      delete the data and start with fresh demo data
// Stop with Ctrl+C. Needs Node 22+ and the installed packages of src/core-backend and src/core-frontend (npm ci).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const DATA = path.join(here, '.data');
const DB = path.join(DATA, 'coregsm.db');
const API_PORT = Number(process.env.PORT_API ?? 3000);
const WEB_PORT = Number(process.env.PORT_WEB ?? 5173);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`\n== ${m}`);

const children = [];
const stopAll = () => {
  for (const c of children.splice(0)) {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
      else c.kill('SIGTERM');
    } catch { /* already gone */ }
  }
};
process.on('exit', stopAll);
process.on('SIGINT', () => { stopAll(); process.exit(0); });
process.on('SIGTERM', () => { stopAll(); process.exit(0); });

const portBusy = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(true));
  s.once('listening', () => s.close(() => resolve(false)));
  s.listen(port, '127.0.0.1');
});

for (const [dir, label] of [['src/core-backend', 'backend'], ['src/core-frontend', 'frontend']]) {
  if (!fs.existsSync(path.join(root, dir, 'node_modules'))) {
    console.error(`The packages of the ${label} are not installed. Run:  cd ${dir} && npm ci   (on Windows with Node 24 better-sqlite3 may need: npm i --no-save better-sqlite3@12)`);
    process.exit(1);
  }
}
const busy = [API_PORT, WEB_PORT].filter((p) => false);
for (const p of [API_PORT, WEB_PORT]) if (await portBusy(p)) busy.push(p);
if (busy.length) {
  console.error(`Port ${busy.join(' and ')} is already in use (the Docker stand, or another run?). Stop it: node tools/dev/dev.mjs down   — or choose other ports: PORT_API=3100 PORT_WEB=5273 node tools/dev/local.mjs`);
  process.exit(1);
}

if (process.argv[2] === 'reset') { say('Deleting the data of the stand'); fs.rmSync(DATA, { recursive: true, force: true }); }
const fresh = !fs.existsSync(DB);
fs.mkdirSync(DATA, { recursive: true });

// the backend: the same file watcher as in the Docker stand (it looks at the files itself, no extra packages)
say('Starting the backend');
const env = {
  ...process.env, NODE_ENV: 'development', PORT: String(API_PORT), DB_PATH: DB,
  JWT_SECRET: 'dev-jwt-secret-dev-jwt-secret-dev-jwt-secret', INTERNAL_TOKEN: 'i'.repeat(48), SETUP_TOKEN: 'seed-code',
  POLL_INTERVAL_SEC: '86400', APP_VERSION_NAME: 'dev', LOG_LEVEL: 'warn',
};
const be = spawn(process.execPath, [path.join(here, 'run-backend.mjs')], { cwd: path.join(root, 'src/core-backend'), env, stdio: 'inherit' });
children.push(be);
be.on('exit', (code) => { if (code) { console.error(`The backend stopped (${code}).`); process.exit(1); } });

for (let i = 0; i < 120; i++) {
  try { const r = await fetch(`http://127.0.0.1:${API_PORT}/api/health`); if (r.ok) break; } catch { /* not yet */ }
  await sleep(500);
  if (i === 119) { console.error('The backend did not come up.'); process.exit(1); }
}

if (fresh) {
  say('Demo data');
  const seed = await import(new URL('../shots/seed.mjs', import.meta.url));
  await seed.seed({ base: `http://127.0.0.1:${API_PORT}`, dbPath: DB });
}

say('Starting the frontend');
const viteBin = path.join(root, 'src/core-frontend/node_modules/vite/bin/vite.js');
const fe = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], {
  cwd: path.join(root, 'src/core-frontend'), env: { ...process.env, COREGSM_API: `http://127.0.0.1:${API_PORT}` }, stdio: 'inherit',
});
children.push(fe);
fe.on('exit', (code) => { if (code) { console.error(`vite stopped (${code}).`); process.exit(1); } });
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://127.0.0.1:${WEB_PORT}/`); if (r.ok) break; } catch { /* not yet */ }
  await sleep(500);
}

say('Ready');
console.log(`  Panel:   http://localhost:${WEB_PORT}   (a change of src/core-frontend shows in the browser by itself)`);
console.log(`  Backend: http://localhost:${API_PORT}   (starts again when a file of src/core-backend changes)`);
console.log('  Sign in: admin / Passw0rd!long');
console.log('  Stop:    Ctrl+C           Fresh data: node tools/dev/local.mjs reset');
await new Promise(() => {});
