/** Games that ship a default cover (files in public/games/covers: <game>.jpg 1280x720 and <game>@s.jpg 640x360). */
const DEFAULT_COVERS = new Set(['vrising', 'icarus']);

/**
 * CSS `background` for a server cover: the uploaded picture (or the default cover of the game) with a dark
 * gradient on top (white text stays readable), the game gradient underneath as a fallback while the picture loads.
 * Without any picture it is just the game gradient.
 */
export function coverBackground(
  coverUrl: string | null | undefined,
  gradient: string,
  opts: { small?: boolean; strong?: boolean; game?: string } = {},
): string {
  let url: string | null = null;
  if (coverUrl) url = opts.small ? `${coverUrl}${coverUrl.includes('?') ? '&' : '?'}s=1` : coverUrl;
  else if (opts.game && DEFAULT_COVERS.has(opts.game)) url = `/games/covers/${opts.game}${opts.small ? '@s' : ''}.jpg`;
  if (!url) return gradient;
  const [a, b] = opts.strong ? [0.3, 0.62] : [0.22, 0.5];
  return `linear-gradient(180deg, rgba(8,10,20,${a}) 0%, rgba(8,10,20,${b}) 100%), url("${url}") center / cover no-repeat, ${gradient}`;
}
