import { useEffect, useState } from 'react';

/**
 * The tile that closes an unfinished row: the one that would stand in the last row with empty places next to it takes them.
 * `ids` are in the order of the grid, `favs` the pinned favourites (they form a group of their own, with a heading, so a row never goes across groups).
 * Returns the id and the number of columns the tile takes, or null when every row is full.
 */
export function lonelyTile(ids: number[], favs: number[], cols: number): { id: number; span: number } | null {
  if (cols < 2 || ids.length === 0) return null;
  const fav = ids.filter((id) => favs.includes(id));
  const last = fav.length > 0 && fav.length < ids.length ? ids.filter((id) => !favs.includes(id)) : ids;
  const r = last.length % cols;
  if (r === 0) return null;
  return { id: last[last.length - 1], span: cols - r + 1 };
}

/** how many columns the grid has now (read from the layout, so it follows the width and the size S / M / L); the second value goes into the  of the grid */
/** how many columns the grid has now (read from the layout, so it follows the width and the size S / M / L); the second value goes into the ref of the grid */
export function useGridColumns(): [number, (el: HTMLElement | null) => void] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [cols, setCols] = useState(1);
  useEffect(() => {
    if (!el) return undefined;
    const read = () => setCols(getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length || 1);
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [cols, setEl];
}
