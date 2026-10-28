/** a picture from public/art (empty states, badges): decorative, the text next to it says the same */
export default function ArtPic({ src, size = 120, className = '' }: { src: `empty/${string}` | `badges/${string}`; size?: number; className?: string }) {
  return <img src={`/art/${src}.webp`} width={size} height={size} alt="" loading="lazy" draggable={false} className={`select-none ${className}`} style={{ width: size, height: size, objectFit: 'contain' }} />;
}
