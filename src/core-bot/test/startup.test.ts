import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { STUCK_MS, stuckFor } from '../src/watchdog.js';

test('modules loaded before the gateway patch do not import discord.js', () => {
  // the proxy hook only works when it is installed before discord.js loads (see index.ts)
  const statics = readFileSync('src/index.ts', 'utf8').match(/^import .* from '(.+)';$/gm) ?? [];
  assert.deepEqual(statics.map((l) => l.replace(/.* from '(.+)';$/, '$1')).sort(), ['./gateway.js', './proxy.js']);
  for (const f of ['src/gateway.ts', 'src/proxy.ts', 'src/log.ts']) assert.doesNotMatch(readFileSync(f, 'utf8'), /from 'discord\.js'/, f);
});

test('SIGTERM stops the bot cleanly even when the panel is unreachable', async () => {
  // without the test runner's own variables, which would turn the child into a test process
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST')));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    env: { ...env, BACKEND_URL: 'http://127.0.0.1:9', INTERNAL_TOKEN: 'x' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`bot did not start:\n${out}`)), 15_000);
    child.stdout.on('data', () => {
      if (out.includes('bot started')) {
        clearTimeout(t);
        resolve();
      }
    });
  });
  const t0 = Date.now();
  child.kill('SIGTERM');
  const code = await new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
  assert.equal(code, 0, out);
  assert.ok(Date.now() - t0 < 8000);
  assert.match(out, /SIGTERM: shutting down/);
  assert.match(out, /stopped/);
});

test('a tick that never finishes is recognised as stuck, a running one is not', () => {
  assert.equal(STUCK_MS, 600_000);
  assert.equal(stuckFor(1_000_000, 0, true), false, 'no tick started');
  assert.equal(stuckFor(1_000_000, 900_000, true), false, 'running for 100 s');
  assert.equal(stuckFor(1_000_000, 100_000, true), true, 'running for 15 min');
  assert.equal(stuckFor(1_000_000, 100_000, false), false, 'not busy');
});
