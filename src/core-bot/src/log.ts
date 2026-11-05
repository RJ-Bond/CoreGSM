import { redact } from './redact.js';

/** one line to stdout; secrets (the token, an address with a password ...) are taken out of every string and error first */
export const log = (...a: unknown[]) =>
  console.log(new Date().toISOString(), ...a.map((x) => (x instanceof Error ? redact(x.stack ?? x.message) : redact(x))));
