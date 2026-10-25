import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * Pictures of players by their game nick: the panel account that linked a nick brings its uploaded picture or its
 * Discord avatar. Nicks are asked for in batches, answers are kept for a few minutes, and a nick without a picture
 * is remembered too, so a list that redraws does not ask again.
 */
const TTL = 5 * 60_000;
const cache = new Map<string, { url: string | null; at: number }>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();
let timer = 0;

const key = (name: string) => name.trim().toLowerCase();

async function flush() {
  timer = 0;
  const batch = [...waiting].slice(0, 100);
  batch.forEach((n) => waiting.delete(n));
  if (!batch.length) return;
  let found: Record<string, string> = {};
  try {
    found = await api<Record<string, string>>(`/avatars-by-nick?${batch.map((n) => `n=${encodeURIComponent(n)}`).join('&')}`);
  } catch {
    /* the pictures are decoration: try again after the next redraw */
    batch.forEach((n) => cache.delete(key(n)));
    return;
  }
  const at = Date.now();
  for (const n of batch) cache.set(key(n), { url: found[key(n)] ?? null, at });
  listeners.forEach((f) => f());
  if (waiting.size) timer = window.setTimeout(() => void flush(), 30);
}

function want(name: string) {
  const k = key(name);
  if (!k) return;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return;
  // a placeholder keeps the nick from being queued twice while the answer is on its way
  if (!hit) cache.set(k, { url: null, at: 0 });
  waiting.add(name.trim());
  if (!timer) timer = window.setTimeout(() => void flush(), 30);
}

/** the picture of one nick (null: none known yet or none at all) */
export function useNickAvatar(name: string): string | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  useEffect(() => { want(name); }, [name]);
  const hit = cache.get(key(name));
  return hit && hit.at > 0 ? hit.url : null;
}
