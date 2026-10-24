/**
 * Graceful shutdown on SIGTERM/SIGINT (docker stop, compose restart, an update): stop accepting connections,
 * let the running poll cycle and backup finish, then close SQLite so the WAL is checkpointed. Docker kills the
 * container 10 s after SIGTERM, so whatever is still pending after FORCE_AFTER_MS is abandoned.
 */
import type { Server } from 'node:http';
import { db } from './db.js';
import { log } from './logger.js';

const FORCE_AFTER_MS = 8000;

type Step = { name: string; run: () => void | Promise<void> };
const steps: Step[] = [];

/** Registers work to finish before the database closes; steps run in parallel. */
export function onShutdown(name: string, run: Step['run']): void {
  steps.push({ name, run });
}

let shuttingDown = false;
export const isShuttingDown = () => shuttingDown;

export async function shutdown(server: Server, signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const t0 = Date.now();
  log.info(`${signal}: shutting down`);
  const force = setTimeout(() => {
    log.error(`shutdown took longer than ${FORCE_AFTER_MS} ms, exiting anyway`);
    process.exit(1);
  }, FORCE_AFTER_MS);
  force.unref();

  // no new connections; idle keep-alive sockets are closed now, busy ones after their response
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  // a slow response (a large backup download) must not hold the database open until the forced exit
  setTimeout(() => server.closeAllConnections(), FORCE_AFTER_MS - 3000).unref();
  await Promise.all([
    closed,
    ...steps.map(async (s) => {
      try {
        await s.run();
      } catch (e) {
        log.error(`shutdown step "${s.name}" failed:`, (e as Error).message);
      }
    }),
  ]);
  try {
    db.close();
  } catch (e) {
    log.error('closing the database failed:', (e as Error).message);
  }
  clearTimeout(force);
  log.info(`stopped in ${Date.now() - t0} ms`);
  process.exit(signal === 'uncaughtException' ? 1 : 0);
}

let mainServer: Server | null = null;
/** The HTTP server that shutdownNow() closes (set once at start). */
export function registerShutdownServer(server: Server): void {
  mainServer = server;
}

/** Starts the same graceful shutdown from code (an uncaught exception); a no-op until the server is registered. */
export async function shutdownNow(signal: string): Promise<void> {
  if (!mainServer) return void process.exit(1);
  await shutdown(mainServer, signal);
}

export function installShutdown(server: Server): void {
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, () => void shutdown(server, sig));
}
