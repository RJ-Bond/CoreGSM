// Small static (no looping motion) SVG illustrations for the empty states of the servers page.
// They use the theme tokens through Tailwind classes, so they work in the light and the dark theme.
import type { ReactNode } from 'react';
import { t } from '../../i18n';

function Frame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 220 150" width={220} height={150} role="img" aria-label={label} className="max-w-full overflow-visible">
      {children}
    </svg>
  );
}

/** an empty rack: dashed slots and a plus */
export function EmptyRackArt() {
  return (
    <Frame label={t('d2.su.noServers')}>
      <ellipse cx="110" cy="134" rx="78" ry="8" className="fill-soft" />
      <circle cx="110" cy="72" r="62" className="fill-soft" />
      {[32, 64, 96].map((y) => (
        <g key={y}>
          <rect x="54" y={y} width="112" height="26" rx="9" className="fill-card stroke-line" strokeWidth="2" strokeDasharray="5 5" />
          <rect x="64" y={y + 10} width="40" height="6" rx="3" className="fill-line" />
          <circle cx="148" cy={y + 13} r="4" className="fill-line" />
        </g>
      ))}
      <circle cx="170" cy="38" r="16" className="fill-brand" />
      <path d="M170 30v16M162 38h16" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
    </Frame>
  );
}

/** a card with an empty star */
export function NoFavsArt() {
  return (
    <Frame label={t('d2.sa.noFavs')}>
      <ellipse cx="110" cy="134" rx="70" ry="8" className="fill-soft" />
      <circle cx="110" cy="72" r="60" className="fill-soft" />
      <rect x="58" y="38" width="104" height="70" rx="14" className="fill-card stroke-line" strokeWidth="2" />
      <rect x="70" y="50" width="44" height="7" rx="3.5" className="fill-line" />
      <rect x="70" y="64" width="64" height="5" rx="2.5" className="fill-line" />
      <rect x="70" y="86" width="80" height="8" rx="4" className="fill-soft" />
      <path
        d="M146 36l5.1 10.4 11.4 1.7-8.25 8 1.95 11.4L146 62.2l-10.2 5.3 1.95-11.4-8.25-8 11.4-1.7z"
        className="fill-card stroke-brand"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeDasharray="4 4"
        transform="translate(0 -8)"
      />
    </Frame>
  );
}

/** a magnifier over a few cards: nothing matched the filter */
export function NoMatchArt() {
  return (
    <Frame label={t('d2.cp.none')}>
      <ellipse cx="110" cy="134" rx="74" ry="8" className="fill-soft" />
      <circle cx="110" cy="72" r="60" className="fill-soft" />
      {[0, 1].map((i) => (
        <g key={i}>
          <rect x={52 + i * 58} y="44" width="52" height="58" rx="12" className="fill-card stroke-line" strokeWidth="2" />
          <rect x={60 + i * 58} y="52" width="36" height="16" rx="6" className="fill-line" />
          <rect x={60 + i * 58} y="76" width="26" height="5" rx="2.5" className="fill-line" />
          <rect x={60 + i * 58} y="88" width="18" height="5" rx="2.5" className="fill-soft" />
        </g>
      ))}
      <circle cx="132" cy="84" r="21" className="fill-card stroke-brand" strokeWidth="5" fillOpacity="0.85" />
      <path d="M147 99l16 16" className="stroke-brand" strokeWidth="7" strokeLinecap="round" />
      <path d="M124 78l16 12M140 78l-16 12" className="stroke-mute" strokeWidth="3" strokeLinecap="round" />
    </Frame>
  );
}
