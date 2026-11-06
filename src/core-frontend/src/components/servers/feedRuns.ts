/** Consecutive entries about the same thing become one entry with a count: ten arrivals of one player on one server are one line. */
export interface Run<T> { item: T; count: number; /** the oldest entry of the run */ last: T }

export function collapseRuns<T>(list: T[], same: (a: T, b: T) => boolean): Run<T>[] {
  const out: Run<T>[] = [];
  for (const item of list) {
    const prev = out[out.length - 1];
    if (prev && same(prev.last, item)) { prev.count++; prev.last = item; } else out.push({ item, count: 1, last: item });
  }
  return out;
}
