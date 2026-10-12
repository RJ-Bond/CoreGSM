// Flat SVG illustrations for empty states and the sign-in screen.
// They use the theme tokens (Tailwind classes), so they look right in the light and the dark theme.

const OK = '#23a55a';
const WARN = '#f0b232';
const BAD = '#f23f42';

function Frame({ children, w = 220, h = 150, label }: { children: React.ReactNode; w?: number; h?: number; label: string }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label} className="max-w-full">
      {children}
    </svg>
  );
}

function Sparkle({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <path d={`M${x} ${y - 6 * s} L${x + 1.6 * s} ${y - 1.6 * s} L${x + 6 * s} ${y} L${x + 1.6 * s} ${y + 1.6 * s} L${x} ${y + 6 * s} L${x - 1.6 * s} ${y + 1.6 * s} L${x - 6 * s} ${y} L${x - 1.6 * s} ${y - 1.6 * s}Z`} className="fill-brand" opacity="0.55" />;
}

/** A small rack of three servers with the three status lights. */
export function ServersArt() {
  const rows = [34, 66, 98];
  const lights = [OK, WARN, BAD];
  return (
    <Frame label="Игровые серверы">
      <ellipse cx="110" cy="132" rx="78" ry="9" className="fill-soft" />
      <circle cx="110" cy="72" r="62" className="fill-soft" />
      {rows.map((y, i) => (
        <g key={y} transform={`translate(${i === 1 ? 6 : 0} 0)`}>
          <rect x="52" y={y} width="116" height="25" rx="9" className="fill-card stroke-line" strokeWidth="2" />
          <rect x="62" y={y + 10} width="46" height="5" rx="2.5" className="fill-line" />
          <circle cx="146" cy={y + 12.5} r="4.2" fill={lights[i]} />
        </g>
      ))}
      <circle cx="170" cy="40" r="15" className="fill-brand" />
      <path d="M170 33v14M163 40h14" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <Sparkle x={44} y={32} /> <Sparkle x={184} y={104} s={0.8} />
    </Frame>
  );
}

/** A megaphone and a sheet of paper. */
export function NewsArt() {
  return (
    <Frame label="Новости">
      <ellipse cx="110" cy="134" rx="76" ry="9" className="fill-soft" />
      <circle cx="108" cy="72" r="60" className="fill-soft" />
      <rect x="112" y="34" width="62" height="78" rx="10" className="fill-card stroke-line" strokeWidth="2" transform="rotate(6 143 73)" />
      <g transform="rotate(6 143 73)">
        <rect x="124" y="48" width="38" height="6" rx="3" className="fill-brand" opacity="0.8" />
        <rect x="124" y="62" width="38" height="4" rx="2" className="fill-line" />
        <rect x="124" y="72" width="30" height="4" rx="2" className="fill-line" />
        <rect x="124" y="82" width="34" height="4" rx="2" className="fill-line" />
        <rect x="124" y="94" width="20" height="9" rx="4.5" fill={OK} opacity="0.85" />
      </g>
      <path d="M44 66h16l34-20v52L60 78H44a6 6 0 0 1-6-6v0a6 6 0 0 1 6-6z" className="fill-brand" />
      <rect x="52" y="78" width="10" height="22" rx="4" className="fill-brand" opacity="0.7" />
      <path d="M102 62c8 4 8 20 0 24" fill="none" className="stroke-brand" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
      <Sparkle x={34} y={40} s={0.9} /> <Sparkle x={186} y={30} s={0.7} />
    </Frame>
  );
}

/** Chat bubbles and a small bot. */
export function DiscordArt() {
  return (
    <Frame label="Discord">
      <ellipse cx="110" cy="134" rx="76" ry="9" className="fill-soft" />
      <circle cx="110" cy="72" r="60" className="fill-soft" />
      <rect x="40" y="36" width="104" height="44" rx="14" className="fill-card stroke-line" strokeWidth="2" />
      <path d="M62 80l-6 14 20-14z" className="fill-card stroke-line" strokeWidth="2" strokeLinejoin="round" />
      <rect x="54" y="48" width="48" height="6" rx="3" className="fill-brand" opacity="0.8" />
      <rect x="54" y="60" width="76" height="5" rx="2.5" className="fill-line" />
      <rect x="108" y="72" width="76" height="38" rx="13" className="fill-brand" />
      <circle cx="132" cy="91" r="3.6" fill="#fff" /><circle cx="160" cy="91" r="3.6" fill="#fff" />
      <path d="M140 99q4 3 8 0" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <rect x="140" y="62" width="4" height="8" rx="2" className="fill-brand" /><circle cx="142" cy="60" r="3.5" fill={WARN} />
      <Sparkle x={34} y={110} s={0.8} /> <Sparkle x={190} y={44} />
    </Frame>
  );
}

/** A picture frame with a mountain, for the cards page. */
export function CardsArt() {
  return (
    <Frame label="Карточки">
      <ellipse cx="110" cy="134" rx="76" ry="9" className="fill-soft" />
      <circle cx="110" cy="72" r="60" className="fill-soft" />
      <rect x="42" y="38" width="136" height="80" rx="14" className="fill-card stroke-line" strokeWidth="2" />
      <rect x="54" y="50" width="52" height="8" rx="4" className="fill-brand" opacity="0.8" />
      <rect x="54" y="64" width="34" height="5" rx="2.5" className="fill-line" />
      <text x="56" y="100" fontSize="26" fontWeight="900" className="fill-ink">26</text>
      <text x="84" y="100" fontSize="13" fontWeight="800" className="fill-mute">/ 40</text>
      <rect x="116" y="50" width="50" height="20" rx="7" className="fill-soft" />
      <rect x="116" y="76" width="50" height="20" rx="7" className="fill-soft" />
      <circle cx="166" cy="104" r="9" fill={OK} /><path d="M162 104l3 3 5-6" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Sparkle x={186} y={42} s={0.8} />
    </Frame>
  );
}
