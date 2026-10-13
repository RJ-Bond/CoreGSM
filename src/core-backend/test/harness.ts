import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export interface Api {
  base: string;
  setupCode: string;
  stop: () => Promise<void>;
  call: (method: string, url: string, opts?: { token?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> }) => Promise<{ status: number; body: any }>;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });

/** Boots the real backend on a fresh database and a free port; every test file gets its own instance. */
export async function startBackend(extraEnv: Record<string, string> = {}): Promise<Api> {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-test-'));
  const setupCode = 'test-setup-code';
  const env = {
    ...process.env,
    PORT: String(port),
    DB_PATH: path.join(dir, 'coregsm.db'),
    DATA_DIR: dir,
    JWT_SECRET: 'j'.repeat(48),
    INTERNAL_TOKEN: 'i'.repeat(48),
    SETUP_TOKEN: setupCode,
    POLL_INTERVAL_SEC: '3600',
    NODE_ENV: 'test',
    ...extraEnv,
  };
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout?.on('data', (d) => (log += String(d)));
  child.stderr?.on('data', (d) => (log += String(d)));
  const base = `http://127.0.0.1:${port}`;

  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`backend exited early:\n${log}`);
    try {
      const r = await fetch(`${base}/api/setup/status`);
      if (r.ok) break;
    } catch {
      /* not listening yet */
    }
    if (Date.now() - started > 30_000) {
      child.kill();
      throw new Error(`backend did not start in 30 s:\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const call: Api['call'] = async (method, url, opts = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    let body: BodyInit | undefined;
    if (opts.raw !== undefined) body = opts.raw;
    else if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const r = await fetch(`${base}${url}`, { method, headers, body });
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not json */
    }
    return { status: r.status, body: parsed };
  };

  return {
    base,
    setupCode,
    call,
    stop: async () => {
      child.kill();
      await new Promise((r) => setTimeout(r, 150));
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* sqlite may still hold the file on Windows */
      }
    },
  };
}

export const ADMIN = { username: 'admin', password: 'Passw0rd!long' };

/** First-run setup; returns the administrator's token. */
export async function setupAdmin(api: Api): Promise<string> {
  const r = await api.call('POST', '/api/setup', { body: { ...ADMIN, code: api.setupCode } });
  if (r.status !== 200 && r.status !== 201) throw new Error(`setup failed: ${r.status} ${JSON.stringify(r.body)}`);
  return (r.body as { token: string }).token;
}
