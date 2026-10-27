#!/usr/bin/env node
// The local development stand in Docker: the panel with demo data, every change of the code is visible at once.
//   node tools/dev/dev.mjs            start (and put the demo data in on the first run)
//   node tools/dev/dev.mjs down       stop (the data stays)
//   node tools/dev/dev.mjs reset      delete the data and start from scratch with fresh demo data
//   node tools/dev/dev.mjs seed       put the demo data in again (only into an empty panel)
//   node tools/dev/dev.mjs logs       follow the logs
//   node tools/dev/dev.mjs status     what is running
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, 'docker-compose.dev.yml');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`\n== ${m}`);

const run = (args, opts = {}) => spawnSync('docker', args, { stdio: 'inherit', ...opts });
const compose = (args, opts = {}) => run(['compose', '-f', FILE, ...args], opts);
const dockerUp = () => spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

async function ensureDocker() {
  if (dockerUp()) return;
  if (process.platform === 'win32') {
    const exe = [process.env.ProgramFiles, process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Programs`]
      .filter(Boolean).map((d) => `${d}\\Docker\\Docker\\Docker Desktop.exe`)[0];
    say('Docker Desktop is not running: starting it (this takes about a minute)');
    try { spawn(exe, [], { detached: true, stdio: 'ignore' }).unref(); } catch { /* the message below says what to do */ }
    for (let i = 0; i < 90; i++) { await sleep(2000); if (dockerUp()) return; }
  }
  console.error('Docker does not answer. Start Docker Desktop, wait until it says "Engine running", and run this command again.');
  process.exit(1);
}

async function waitHealthy() {
  say('Waiting for the backend (the first start installs the packages: up to 5 minutes)');
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch('http://127.0.0.1:3000/api/health'); if (r.ok) return; } catch { /* not yet */ }
    await sleep(2000);
  }
  console.error('The backend did not come up. Look at the log: node tools/dev/dev.mjs logs');
  process.exit(1);
}

const cmd = process.argv[2] ?? 'up';
if (!['up', 'down', 'reset', 'seed', 'logs', 'status'].includes(cmd)) {
  console.error('Commands: up (default), down, reset, seed, logs, status');
  process.exit(2);
}
await ensureDocker();

if (cmd === 'down') process.exit(compose(['down']).status ?? 0);
if (cmd === 'logs') process.exit(compose(['logs', '-f', '--tail', '80']).status ?? 0);
if (cmd === 'status') process.exit(compose(['ps']).status ?? 0);
if (cmd === 'reset') { say('Deleting the data of the stand'); compose(['down', '-v']); }

if (cmd === 'up' || cmd === 'reset') {
  say('Starting the stand');
  if (compose(['up', '-d', '--build']).status !== 0) process.exit(1);
}
await waitHealthy();
say('Demo data');
if (compose(['exec', '-T', 'backend', 'node', '/app/tools/dev/seed.mjs']).status !== 0) process.exit(1);

say('Ready');
console.log('  Panel:   http://localhost:5173   (changes of src/core-frontend appear in the browser by themselves)');
console.log('  Backend: http://localhost:3000   (restarts when a file of src/core-backend changes)');
console.log('  Sign in: admin / Passw0rd!long');
console.log('  Stop:    node tools/dev/dev.mjs down        Fresh data: node tools/dev/dev.mjs reset');
