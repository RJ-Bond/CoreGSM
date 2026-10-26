import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'coregsm_draft:';
/** a draft older than this is not worth restoring */
const KEEP_MS = 14 * 86_400_000;

function load(key: string): string {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return '';
    const v = JSON.parse(raw) as { t?: unknown; at?: unknown };
    if (typeof v.t !== 'string' || typeof v.at !== 'number' || Date.now() - v.at > KEEP_MS) { localStorage.removeItem(PREFIX + key); return ''; }
    return v.t;
  } catch {
    return '';
  }
}

/**
 * A text that survives a reload, a closed tab or a lost connection: kept in this browser a moment after the last key,
 * dropped by `clear()` (after sending) and when it becomes empty. `key` names the place it belongs to (one comment box).
 * Without a key it is a plain state.
 */
export function useDraft(key: string | null, initial = ''): [string, (v: string) => void, () => void, boolean] {
  const [text, setText] = useState(() => initial || (key ? load(key) : ''));
  const restored = useRef(!initial && !!key && text !== '');
  const timer = useRef(0);
  const set = useCallback((v: string) => {
    setText(v);
    if (!key) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      try {
        if (v.trim()) localStorage.setItem(PREFIX + key, JSON.stringify({ t: v, at: Date.now() }));
        else localStorage.removeItem(PREFIX + key);
      } catch { /* private mode: the draft lives until the page is closed */ }
    }, 400);
  }, [key]);
  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    setText('');
    if (key) { try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ } }
  }, [key]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [text, set, clear, restored.current];
}
