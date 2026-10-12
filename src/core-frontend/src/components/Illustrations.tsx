// Flat SVG illustrations for empty states, 404 and the sign-in screen.
// They use the theme tokens (Tailwind classes), so they look right in the light and the dark theme.
// Motion is CSS only (.art-* classes in index.css) and is switched off for prefers-reduced-motion.

const OK = '#23a55a';
const WARN = '#f0b232';
const BAD = '#f23f42';

function Frame({ children, w = 220, h = 150, label }: { children: React.ReactNode; w?: number; h?: number; label: string }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label} className="max-w-full overflow-visible">
      {children}
    </svg>
  );
}

function Sparkle({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <path
      d={`M${x} ${y - 6 * s} L${x + 1.6 * s} ${y - 1.6 * s} L${x + 6 * s} ${y} L${x + 1.6 * s} ${y + 1.6 * s} L${x} ${y + 6 * s} L${x - 1.6 * s} ${y + 1.6 * s} L${x - 6 * s} ${y} L${x - 1.6 * s} ${y - 1.6 * s}Z`}
      className="fill-brand art-twinkle"
      opacity="0.55"
      style={{ animationDelay: `${((x * 7 + y * 3) % 20) / 10}s` }}
    />
  );
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
          <circle cx="146" cy={y + 12.5} r="4.2" fill={lights[i]} className="art-blink" style={{ animationDelay: `${i * 0.7}s` }} />
        </g>
      ))}
      <g className="art-float">
        <circle cx="170" cy="40" r="15" className="fill-brand" />
        <path d="M170 33v14M163 40h14" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </g>
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
      <g className="art-float-2">
        <rect x="112" y="34" width="62" height="78" rx="10" className="fill-card stroke-line" strokeWidth="2" transform="rotate(6 143 73)" />
        <g transform="rotate(6 143 73)">
          <rect x="124" y="48" width="38" height="6" rx="3" className="fill-brand" opacity="0.8" />
          <rect x="124" y="62" width="38" height="4" rx="2" className="fill-line" />
          <rect x="124" y="72" width="30" height="4" rx="2" className="fill-line" />
          <rect x="124" y="82" width="34" height="4" rx="2" className="fill-line" />
          <rect x="124" y="94" width="20" height="9" rx="4.5" fill={OK} opacity="0.85" />
        </g>
      </g>
      <g className="art-wobble">
        <path d="M44 66h16l34-20v52L60 78H44a6 6 0 0 1-6-6v0a6 6 0 0 1 6-6z" className="fill-brand" />
        <rect x="52" y="78" width="10" height="22" rx="4" className="fill-brand" opacity="0.7" />
      </g>
      <path d="M102 62c8 4 8 20 0 24" fill="none" className="stroke-brand art-blink" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
      <path d="M110 54c14 7 14 40 0 48" fill="none" className="stroke-brand art-blink" strokeWidth="3" strokeLinecap="round" opacity="0.3" style={{ animationDelay: '.4s' }} />
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
      <g className="art-float">
        <rect x="40" y="36" width="104" height="44" rx="14" className="fill-card stroke-line" strokeWidth="2" />
        <path d="M62 80l-6 14 20-14z" className="fill-card stroke-line" strokeWidth="2" strokeLinejoin="round" />
        <rect x="54" y="48" width="48" height="6" rx="3" className="fill-brand" opacity="0.8" />
        <rect x="54" y="60" width="76" height="5" rx="2.5" className="fill-line" />
      </g>
      <g className="art-float-2">
        <rect x="108" y="72" width="76" height="38" rx="13" className="fill-brand" />
        <circle cx="132" cy="91" r="3.6" fill="#fff" /><circle cx="160" cy="91" r="3.6" fill="#fff" />
        <path d="M140 99q4 3 8 0" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <rect x="140" y="62" width="4" height="8" rx="2" className="fill-brand" /><circle cx="142" cy="60" r="3.5" fill={WARN} className="art-blink" />
      </g>
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
      <g className="art-float">
        <rect x="42" y="38" width="136" height="80" rx="14" className="fill-card stroke-line" strokeWidth="2" />
        <rect x="54" y="50" width="52" height="8" rx="4" className="fill-brand" opacity="0.8" />
        <rect x="54" y="64" width="34" height="5" rx="2.5" className="fill-line" />
        <text x="56" y="100" fontSize="26" fontWeight="900" className="fill-ink">26</text>
        <text x="84" y="100" fontSize="13" fontWeight="800" className="fill-mute">/ 40</text>
        <rect x="116" y="50" width="50" height="20" rx="7" className="fill-soft" />
        <rect x="116" y="76" width="50" height="20" rx="7" className="fill-soft" />
        <circle cx="166" cy="104" r="9" fill={OK} /><path d="M162 104l3 3 5-6" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <Sparkle x={186} y={42} s={0.8} />
    </Frame>
  );
}

/** A bell with a ripple: nothing was sent yet. */
export function AlertsArt() {
  return (
    <Frame label="Оповещения" w={200} h={130}>
      <ellipse cx="100" cy="118" rx="62" ry="7" className="fill-soft" />
      <circle cx="100" cy="62" r="50" className="fill-soft" />
      <g className="art-wobble">
        <path d="M100 26c-18 0-28 14-28 32 0 18-8 24-12 28h80c-4-4-12-10-12-28 0-18-10-32-28-32z" className="fill-card stroke-line" strokeWidth="2" strokeLinejoin="round" />
        <rect x="76" y="40" width="10" height="26" rx="5" className="fill-brand" opacity="0.18" />
        <circle cx="100" cy="94" r="7" className="fill-brand" />
        <circle cx="100" cy="21" r="4" className="fill-brand" />
      </g>
      <path d="M142 40c6 6 8 14 6 22" fill="none" className="stroke-brand art-blink" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
      <path d="M58 40c-6 6-8 14-6 22" fill="none" className="stroke-brand art-blink" strokeWidth="3" strokeLinecap="round" opacity="0.5" style={{ animationDelay: '.5s' }} />
      <circle cx="140" cy="82" r="10" fill={OK} /><path d="M135 82l3.500 3.500 6.500-7" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Sparkle x={30} y={90} s={0.8} /> <Sparkle x={172} y={22} s={0.7} />
    </Frame>
  );
}

/** A server with an unplugged cable and a question mark: the page or the server does not exist. */
export function NotFoundArt() {
  return (
    <Frame label="Страница не найдена" w={260} h={170}>
      <ellipse cx="130" cy="152" rx="92" ry="9" className="fill-soft" />
      <circle cx="130" cy="82" r="72" className="fill-soft" />
      <g className="art-float">
        <rect x="70" y="40" width="120" height="30" rx="11" className="fill-card stroke-line" strokeWidth="2" />
        <rect x="70" y="76" width="120" height="30" rx="11" className="fill-card stroke-line" strokeWidth="2" />
        <rect x="82" y="52" width="48" height="6" rx="3" className="fill-line" />
        <rect x="82" y="88" width="34" height="6" rx="3" className="fill-line" />
        <circle cx="166" cy="55" r="5" fill={WARN} className="art-blink" />
        <circle cx="166" cy="91" r="5" fill={BAD} className="art-blink" style={{ animationDelay: '.8s' }} />
        <circle cx="150" cy="55" r="5" className="fill-line" />
        <circle cx="150" cy="91" r="5" className="fill-line" />
      </g>
      {/* the loose cable */}
      <path d="M130 106c0 16-14 14-14 26s16 8 24 14" fill="none" className="stroke-brand" strokeWidth="4" strokeLinecap="round" />
      <g className="art-wobble">
        <rect x="140" y="140" width="22" height="13" rx="4" className="fill-brand" />
        <rect x="162" y="143" width="9" height="3" rx="1.5" className="fill-mute" />
        <rect x="162" y="148" width="9" height="3" rx="1.5" className="fill-mute" />
      </g>
      <g className="art-float-2">
        <circle cx="206" cy="46" r="17" className="fill-brand" />
        <text x="206" y="53" textAnchor="middle" fontSize="22" fontWeight="900" fill="#fff">?</text>
      </g>
      <Sparkle x={52} y={44} /> <Sparkle x={226} y={104} s={0.8} /> <Sparkle x={40} y={110} s={0.7} />
    </Frame>
  );
}
