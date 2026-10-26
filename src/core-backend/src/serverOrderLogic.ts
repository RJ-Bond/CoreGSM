/** Manual order of servers: the pure part (the route only saves the result). */

/**
 * The full order after the person arranged some servers: `ids` are the ones they placed (in that order),
 * `all` is every server id in the current display order. Unknown ids are dropped, duplicates ignored,
 * and servers that were not mentioned keep their relative order after the placed ones.
 */
export function completeOrder(ids: number[], all: number[]): number[] {
  const known = new Set(all);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of all) if (!seen.has(id)) out.push(id);
  return out;
}
