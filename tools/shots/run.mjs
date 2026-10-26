#!/usr/bin/env node
// Screenshots + automatic UI checks of the panel. No dependencies: Node 22 and an installed Chrome / Chromium.
//   node tools/shots/run.mjs --pages=server --viewports=phone --themes=dark,light
// Starts a demo backend (own database in a temp folder) and the vite dev server, seeds them, drives Chrome over the
// DevTools protocol, writes one full-page picture per page / viewport / theme and a report of what looks broken.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_PAGES, GUEST_PAGES, HELP, buildMatrix, formatReport, isExpectedFailure, parseArgs, viewportOf } from './lib.mjs';
import { ADMIN, seed } from './seed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_H = 7000;

const opts = parseArgs(process.argv.slice(2));
if (opts.help) { console.log(HELP); process.exit(0); }
if (opts.list) { console.log([...GUEST_PAGES, ...ADMIN_PAGES].map((p) => `${p.id.padEnd(22)} ${p.path}`).join('\n')); process.exit(0); }

const children = [];
const kill = (c) => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGKILL');
  } catch { /* already gone */ }
};
const cleanup = () => { for (const c of children.splice(0)) kill(c); };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});
const waitHttp = async (url, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not yet */ }
    await sleep(400);
  }
  throw new Error(`Nothing answers at ${url}`);
};

function findChrome() {
  const env = process.env.CHROME_PATH;
  const list = [env, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const hit = list.find((p) => p && fs.existsSync(p));
  if (!hit) throw new Error('Chrome not found. Set CHROME_PATH to its executable.');
  return hit;
}

// ---------------------------------------------------------------- the stack
async function startStack() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-shots-'));
  const dbPath = path.join(tmp, 'coregsm.db');
  const bp = await freePort();
  const fp = await freePort();
  const be = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.join(root, 'src/core-backend'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test', PORT: String(bp), DB_PATH: dbPath, JWT_SECRET: 'j'.repeat(40), INTERNAL_TOKEN: 'i'.repeat(48), SETUP_TOKEN: 'seed-code', POLL_INTERVAL_SEC: '86400', APP_VERSION_NAME: process.env.APP_VERSION_NAME ?? '1.0.0.0' },
  });
  children.push(be);
  let beLog = '';
  be.stdout.on('data', (d) => { beLog += d; });
  be.stderr.on('data', (d) => { beLog += d; });
  await waitHttp(`http://127.0.0.1:${bp}/api/setup/status`).catch((e) => { throw new Error(`${e.message}\n${beLog.slice(-1500)}`); });

  const viteBin = path.join(root, 'src/core-frontend/node_modules/vite/bin/vite.js');
  const fe = spawn(process.execPath, [viteBin, '--port', String(fp), '--strictPort', '--host', '127.0.0.1'], {
    cwd: path.join(root, 'src/core-frontend'), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, COREGSM_API: `http://127.0.0.1:${bp}` },
  });
  children.push(fe);
  await waitHttp(`http://127.0.0.1:${fp}/`);
  await seed({ base: `http://127.0.0.1:${bp}`, dbPath });
  return { base: `http://127.0.0.1:${fp}`, tmp };
}

// ---------------------------------------------------------------- Chrome over the DevTools protocol
async function launchChrome() {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-chrome-'));
  const ch = spawn(findChrome(), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--ignore-certificate-errors',
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  children.push(ch);
  let list;
  for (let i = 0; i < 60 && !list?.length; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(300); } }
  const target = list?.find((t) => t.type === 'page');
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const handlers = new Set();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) handlers.forEach((h) => h(d));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (d) => (d.error ? reject(new Error(`${method}: ${d.error.message}`)) : resolve(d.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  for (const m of ['Page', 'Network', 'Runtime', 'Log']) await send(`${m}.enable`);
  return { send, evaluate, on: (h) => { handlers.add(h); return () => handlers.delete(h); } };
}

// ---------------------------------------------------------------- one page
const checksSource = fs.readFileSync(path.join(here, 'checks.js'), 'utf8');
const axePath = path.join(root, 'src/core-frontend/node_modules/axe-core/axe.min.js');
const axeSource = fs.existsSync(axePath) ? fs.readFileSync(axePath, 'utf8') : '';
const RUN_AXE = `axe.run(document,{runOnly:['wcag2a','wcag2aa'],resultTypes:['violations']}).then(r=>r.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>({id:v.id,impact:v.impact,n:v.nodes.length,help:v.help,first:(v.nodes[0]?.target||[]).join(' ').slice(0,90)})))`;
const KILL_MOTION = `(()=>{const s=document.createElement('style');s.textContent='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important} main{opacity:1!important}';document.head.appendChild(s)})()`;
const HIDE_BARS = `(()=>{for(const el of document.querySelectorAll('body *')){const cs=getComputedStyle(el);if(cs.position!=='fixed')continue;const r=el.getBoundingClientRect();if(r.top>innerHeight*0.6&&r.height<150&&!el.closest('[role=dialog]'))el.style.visibility='hidden'}})()`;

async function shoot(cdp, base, row, outDir) {
  const { page, viewport, theme } = row;
  const vp = viewportOf(viewport);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  const script = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('coregsm_theme','${theme}')}catch{}` });

  const errors = [];
  const warnings = [];
  let inflight = 0;
  let lastNet = Date.now();
  const urls = new Map();
  const off = cdp.on((e) => {
    const p = e.params;
    if (e.method === 'Network.requestWillBeSent' && !['EventSource', 'WebSocket'].includes(p.type)) { inflight++; lastNet = Date.now(); urls.set(p.requestId, p.request.url); }
    else if (e.method === 'Network.loadingFinished') { if (urls.has(p.requestId)) { inflight--; lastNet = Date.now(); } }
    else if (e.method === 'Network.loadingFailed') {
      if (urls.has(p.requestId)) { inflight--; lastNet = Date.now(); if (!p.canceled && !/ERR_ABORTED/.test(p.errorText)) errors.push(`request failed: ${urls.get(p.requestId).replace(/^https?:\/\/[^/]+/, '')} (${p.errorText})`); }
    } else if (e.method === 'Network.responseReceived' && p.response.status >= 400 && !isExpectedFailure(p.response.url, p.response.status)) {
      errors.push(`HTTP ${p.response.status} ${p.response.url.replace(/^https?:\/\/[^/]+/, '')}`);
    } else if (e.method === 'Runtime.exceptionThrown') {
      errors.push(`script error: ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).split('\n')[0].slice(0, 160)}`);
    } else if (e.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
      errors.push(`console.error: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160)}`);
    }
  });

  await cdp.send('Page.navigate', { url: base + page.path });
  const t0 = Date.now();
  await sleep(600);
  while (Date.now() - t0 < 15000 && (inflight > 0 || Date.now() - lastNet < 700)) await sleep(150);
  await cdp.evaluate(KILL_MOTION);
  await sleep(500);

  const c = await cdp.evaluate(checksSource);
  off();
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier }).catch(() => undefined);

  if (c.scrollW > c.vw + 1) errors.push(`horizontal scroll: page is ${c.scrollW}px wide in a ${c.vw}px window${c.wide.length ? `; widest: ${c.wide.slice(0, 3).join(' | ')}` : ''}`);
  else if (c.wide.length) warnings.push(`sticks out of the window: ${c.wide.slice(0, 3).join(' | ')}`);
  if (c.pillOff) errors.push(`the current-tab pill is in the wrong place: ${c.pillOff}`);
  if (c.badText) errors.push(`leaked value in the text: "${c.badText}"`);
  if (c.brokenImg.length) errors.push(`broken picture: ${c.brokenImg.join(', ')}`);
  if (c.mainEmpty && page.id !== 'not-found') errors.push('the page is empty');
  if (c.cut.length) warnings.push(`text cut off by its container: ${c.cut.slice(0, 3).join(' | ')}`);
  if (c.clipped.length) warnings.push(`text cut off without an ellipsis: ${c.clipped.slice(0, 3).join(' | ')}`);
  if (c.tiny.length) warnings.push(`small tap targets: ${c.tiny.slice(0, 3).join(' | ')}`);
  if (c.noName.length) warnings.push(`controls without a name: ${c.noName.slice(0, 3).join(' | ')}`);
  if (c.busy) warnings.push(`${c.busy} loading placeholders still on screen`);
  if (c.height > MAX_H) warnings.push(`the picture is cut at ${MAX_H}px of ${c.height}px`);

  if (axeSource && !opts['no-axe']) {
    try {
      await cdp.evaluate(axeSource);
      for (const v of await cdp.evaluate(RUN_AXE)) warnings.push(`a11y ${v.id} (${v.impact}, ${v.n}): ${v.help}; e.g. ${v.first}`);
    } catch (e) { warnings.push(`axe did not run: ${e.message.slice(0, 80)}`); }
  }
  await cdp.evaluate(HIDE_BARS);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: vp.width, height: Math.min(c.height, MAX_H), scale: 1 } });
  const dir = path.join(outDir, `${theme}-${viewport}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${page.id}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return { id: page.id, path: page.path, viewport, theme, file: path.relative(process.cwd(), file).replaceAll('\\', '/'), errors: [...new Set(errors)].slice(0, 8), warnings, title: c.title, h1: c.h1 };
}

// ---------------------------------------------------------------- main
async function main() {
  const outDir = path.resolve(String(opts.out ?? 'shots-out'));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  let base = opts.base ? String(opts.base).replace(/\/$/, '') : null;
  let login = ADMIN;
  let hasAdmin = true;
  if (base) {
    const m = typeof opts.login === 'string' ? /^([^:]+):(.+)$/.exec(opts.login) : null;
    login = m ? { username: m[1], password: m[2] } : null;
    hasAdmin = !!login;
  } else {
    console.log('Starting the demo panel…');
    base = (await startStack()).base;
  }
  const rows = buildMatrix(opts, hasAdmin);
  if (!rows.length) throw new Error('Nothing to shoot');
  // guests first: signing in changes every page
  rows.sort((a, b) => Number(!!a.page.admin) - Number(!!b.page.admin));

  console.log(`Shooting ${rows.length} pictures from ${base}`);
  const cdp = await launchChrome();
  const results = [];
  let signedIn = false;
  for (const row of rows) {
    if (row.page.admin && !signedIn) {
      await cdp.send('Page.navigate', { url: `${base}/login` });
      await sleep(2500);
      const r = await cdp.evaluate(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json','x-coregsm':'1'},body:JSON.stringify(${JSON.stringify(login)})}).then(r=>{try{localStorage.setItem('coregsm_signed','1')}catch{};return r.status})`);
      if (r !== 200) throw new Error(`Sign-in failed (HTTP ${r})`);
      signedIn = true;
    }
    try {
      const res = await shoot(cdp, base, row, outDir);
      results.push(res);
      const mark = res.errors.length ? 'ERR ' : res.warnings.length ? 'warn' : ' ok ';
      console.log(`  [${mark}] ${row.theme}/${row.viewport} ${row.page.id}`);
    } catch (e) {
      results.push({ id: row.page.id, path: row.page.path, viewport: row.viewport, theme: row.theme, file: '-', errors: [`harness: ${e.message}`], warnings: [] });
      console.log(`  [ERR ] ${row.theme}/${row.viewport} ${row.page.id}: ${e.message}`);
    }
  }
  const report = formatReport(results, { strict: !!opts.strict });
  fs.writeFileSync(path.join(outDir, 'report.md'), report.text);
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 2));
  console.log(`\n${report.text}\nPictures and report: ${path.relative(process.cwd(), outDir) || '.'}`);
  if (opts.keep && !opts.base) { console.log(`Demo panel is running: ${base} (admin / ${ADMIN.password}). Ctrl+C to stop.`); await new Promise(() => {}); }
  cleanup();
  process.exit(report.failed ? 1 : 0);
}

main().catch((e) => { console.error(e.stack ?? e.message); cleanup(); process.exit(2); });
