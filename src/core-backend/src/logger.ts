import pino from 'pino';

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
});

function detail(rest: unknown[]): Record<string, unknown> | undefined {
  if (!rest.length) return undefined;
  const err = rest.find((x) => x instanceof Error) as Error | undefined;
  const text = rest.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  return err ? { err, detail: text } : { detail: text };
}

function make(level: 'info' | 'warn' | 'error') {
  return (msg: unknown, ...rest: unknown[]): void => {
    if (msg instanceof Error) return void base[level]({ err: msg }, msg.message);
    const d = detail(rest);
    if (d) base[level](d, String(msg));
    else base[level](String(msg));
  };
}

export const log = { info: make('info'), warn: make('warn'), error: make('error') };
