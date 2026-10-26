/** WebP delivery of stored pictures: the pure part (negotiation and a small byte-bounded cache). */

/** does the Accept header of the request take WebP (with a quality above zero)? */
export function wantsWebp(accept: string | undefined): boolean {
  if (!accept) return false;
  return accept.split(',').some((part) => {
    const [type, ...params] = part.trim().split(';');
    if (type?.trim().toLowerCase() !== 'image/webp') return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  });
}

/** a cache that forgets the oldest entries when the bytes exceed the limit */
export class ByteLru<V extends { length: number }> {
  private map = new Map<string, V>();
  private bytes = 0;
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V): void {
    if (value.length > this.limit) return;
    const old = this.map.get(key);
    if (old) this.bytes -= old.length;
    this.map.delete(key);
    this.map.set(key, value);
    this.bytes += value.length;
    for (const [k, v] of this.map) {
      if (this.bytes <= this.limit) break;
      if (k === key) continue;
      this.map.delete(k);
      this.bytes -= v.length;
    }
  }
  get size(): number {
    return this.map.size;
  }
  get totalBytes(): number {
    return this.bytes;
  }
}
