/** Which accounts the avatar sync visits next. Pure. */

/** the next users of a round: those after `cursor` (by id), then from the start */
export function nextBatch<T extends { id: number }>(rows: T[], cursor: number, n: number): T[] {
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  const after = sorted.filter((r) => r.id > cursor);
  return [...after, ...sorted.filter((r) => r.id <= cursor)].slice(0, n);
}
