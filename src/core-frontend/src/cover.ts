/**
 * CSS `background` for a server cover: the uploaded picture with a dark gradient on top (white text stays readable),
 * the game gradient underneath as a fallback while the picture loads. Without a picture it is just the game gradient.
 */
export function coverBackground(coverUrl: string | null | undefined, gradient: string, opts: { small?: boolean; strong?: boolean } = {}): string {
  if (!coverUrl) return gradient;
  const url = opts.small ? `${coverUrl}${coverUrl.includes('?') ? '&' : '?'}s=1` : coverUrl;
  const [a, b] = opts.strong ? [0.38, 0.7] : [0.28, 0.58];
  return `linear-gradient(180deg, rgba(8,10,20,${a}) 0%, rgba(8,10,20,${b}) 100%), url("${url}") center / cover no-repeat, ${gradient}`;
}
