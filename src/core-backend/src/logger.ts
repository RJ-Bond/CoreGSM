import pino from 'pino';
import { redact } from './security/redact.js';

/**
 * Structured logging (JSON lines on stdout). Level via LOG_LEVEL (default info,
 * "silent" under tests). Call sites keep the console-like shape:
 *   log.error('poll failed', err)   → {"level":50,"msg":"poll failed","detail":"..."}
 */
const base = pino({
  level: process.env.LOG_LEVEL || (process.env.VITEST || process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  // an error from a library can carry a token or a password in its message or its stack
  serializers: { err: (e: Error) => ({ type: e.name, message: redact(e.message), stack: redact(e.stack ?? '') }) },
});

function detail(rest: unknown[]): Record<string, unknown> | undefined {
  if (!rest.length) return undefined;
  const err = rest.find((x) => x instanceof Error) as Error | undefined;
  const text = redact(rest.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  return err ? { err, detail: text } : { detail: text };
}

function make(level: 'info' | 'warn' | 'error') {
  return (msg: unknown, ...rest: unknown[]): void => {
    if (msg instanceof Error) return void base[level]({ err: msg }, redact(msg.message));
    const d = detail(rest);
    if (d) base[level](d, redact(String(msg)));
    else base[level](redact(String(msg)));
  };
}

export const log = { info: make('info'), warn: make('warn'), error: make('error') };
