// Runs the backend and starts it again when a file of src/ changes. It looks at the files itself (every second):
// the usual file watchers get no events for folders mounted from Windows into a container. No dependencies.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WATCH = path.join(ROOT, 'src');
const EVERY_MS = 1000;
const CALM_MS = 400;

/** "path:mtime:size" of every source file: the signature of the folder */
function signature(dir) {
  let sig = '';
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|js|mjs|json)$/.test(e.name)) {
        try { const s = fs.statSync(p); sig += `${p}:${s.mtimeMs}:${s.size}\n`; } catch { /* removed meanwhile */ }
      }
    }
  };
  walk(dir);
  return sig;
}

let child = null;
let stopping = false;
function start() {
  console.log('[dev] starting the backend');
  child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: ROOT, stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    child = null;
    if (!stopping && !restarting) console.log(`[dev] the backend stopped (${signal ?? code}); waiting for a change of the code`);
  });
}
let restarting = false;
async function restart() {
  restarting = true;
  if (child) {
    const c = child;
    await new Promise((resolve) => { c.once('exit', resolve); c.kill('SIGTERM'); setTimeout(() => c.kill('SIGKILL'), 4000).unref(); });
  }
  restarting = false;
  start();
}

let last = signature(WATCH);
let changedAt = 0;
setInterval(() => {
  const now = signature(WATCH);
  if (now !== last) { last = now; changedAt = Date.now(); }
  if (changedAt && Date.now() - changedAt >= CALM_MS) {
    changedAt = 0;
    console.log('[dev] the code changed: restarting the backend');
    void restart();
  }
}, EVERY_MS);

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { stopping = true; child?.kill('SIGTERM'); setTimeout(() => process.exit(0), 500); });
}
start();
