/** the browser side of the sign-in puzzle (core-backend/src/security/powCaptcha.ts): find a nonce so SHA-256(challenge:nonce) starts with `bits` zero bits */
import { api } from './api';

export function zeroBits(h: Uint8Array): number {
  let n = 0;
  for (const b of h) {
    if (b === 0) { n += 8; continue; }
    n += Math.clz32(b) - 24;
    break;
  }
  return n;
}

export async function solve(challenge: string, bits: number): Promise<string> {
  const enc = new TextEncoder();
  const BATCH = 512;
  for (let base = 0; ; base += BATCH) {
    const hashes = await Promise.all(Array.from({ length: BATCH }, (_, i) => crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${base + i}`))));
    for (let i = 0; i < BATCH; i++) if (zeroBits(new Uint8Array(hashes[i])) >= bits) return String(base + i);
  }
}

/** a fresh puzzle from the panel, solved: what the sign-in request carries as `pow` */
export async function fetchProof(): Promise<{ challenge: string; nonce: string }> {
  const c = await api<{ challenge: string; bits: number }>('/auth/challenge');
  return { challenge: c.challenge, nonce: await solve(c.challenge, c.bits) };
}
