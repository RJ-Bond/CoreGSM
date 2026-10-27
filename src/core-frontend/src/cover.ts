import { GAME_IMAGE } from './games';
/** Games that ship a default cover (files in public/games/covers: <game>.jpg 1280x720 and <game>@s.jpg 640x360). */
const DEFAULT_COVERS = new Set(['vrising', 'icarus', 'm2o', 'rust', 'minecraft', 'counterstrike2', 'palworld', 'valheim', 'terraria', 'asa', 'sdtd', 'dayz', 'conanexiles', 'projectzomboid', 'unturned']);

/** the picture of a server: its uploaded cover, else the default cover of its game, else null (small = the 640px one) */
export function coverUrlOf(coverUrl: string | null | undefined, game: string, small = true): string | null {
  if (coverUrl) return small ? `${coverUrl}${coverUrl.includes('?') ? '&' : '?'}s=1` : coverUrl;
  return DEFAULT_COVERS.has(game) ? `/games/covers/${game}${small ? '@s' : ''}.jpg` : null;
}

/**
 * A server without a picture of its own and without a default cover gets its game's emblem as a faint watermark
 * on the plain gradient (see .emblem-bg in servers.css). Returns the style variable for it, or {}.
 */
export function emblemStyle(coverUrl: string | null | undefined, game: string): { className: string; style: Record<string, string> } {
  const url = coverUrlOf(coverUrl, game, false) ? null : GAME_IMAGE[game];
  return url ? { className: 'emblem-bg', style: { '--emblem': `url("${url}")` } } : { className: '', style: {} };
}

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
  const [a, b] = opts.strong ? ['var(--cv-a, .3)', 'var(--cv-b, .62)'] : [0.22, 0.5];
  return `linear-gradient(180deg, rgba(8,10,20,${a}) 0%, rgba(8,10,20,${b}) 100%), url("${url}") center / cover no-repeat, ${gradient}`;
}

/**
 * The background of a game without a picture: a deep, dark base tinted by the game colour with a soft glow in the
 * corner, instead of a flat saturated slab (white text stays readable, the page stays calm).
 */
export function gameBackdrop(color: string, angle = 140): string {
  return `radial-gradient(120% 130% at 100% 0%, ${color}b3 0%, ${color}33 45%, transparent 70%), linear-gradient(${angle}deg, color-mix(in srgb, ${color} 34%, #0d0f1a), #0b0c16)`;
}
