/**
 * Small pictures for the empty lists: one for each kind of thing the list would hold (a calendar for the windows, a chat bubble for the
 * announcements, a key for the keys…). Drawn with the colours of the theme (the accent, the soft tone, the line), so they follow the look
 * and the accent; no files to load.
 */
import type { ReactNode } from 'react';

export type ArtScene = 'calendar' | 'chat' | 'key' | 'news' | 'chart' | 'shield' | 'plug' | 'bell' | 'users' | 'server';

const BRAND = 'rgb(var(--brand))';
const SOFT = 'rgb(var(--soft))';
const LINE = 'rgb(var(--line))';
const CARD = 'rgb(var(--card))';
const MUTE = 'rgb(var(--mute) / .55)';

/** the round soft ground and two small spots every picture has */
const Ground = ({ children }: { children: ReactNode }) => (
  <>
    <ellipse cx="60" cy="84" rx="38" ry="5" fill={LINE} opacity=".5" />
    <circle cx="60" cy="46" r="38" fill={SOFT} />
    <circle cx="20" cy="26" r="3" fill={BRAND} opacity=".5" />
    <circle cx="102" cy="64" r="2.5" fill={BRAND} opacity=".35" />
    <path d="M100 18l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill={BRAND} opacity=".6" />
    {children}
  </>
);

const SCENES: Record<ArtScene, ReactNode> = {
  calendar: (
    <Ground>
      <rect x="34" y="28" width="52" height="46" rx="8" fill={CARD} stroke={LINE} strokeWidth="2" />
      <path d="M34 42h52" stroke={LINE} strokeWidth="2" />
      <rect x="34" y="28" width="52" height="14" rx="8" fill={BRAND} opacity=".9" />
      <path d="M46 24v8M74 24v8" stroke={BRAND} strokeWidth="3" strokeLinecap="round" />
      <g fill={MUTE}><circle cx="46" cy="54" r="2.5" /><circle cx="60" cy="54" r="2.5" /><circle cx="74" cy="54" r="2.5" /><circle cx="46" cy="65" r="2.5" /><circle cx="60" cy="65" r="2.5" /></g>
      <circle cx="74" cy="65" r="4" fill={BRAND} />
    </Ground>
  ),
  chat: (
    <Ground>
      <path d="M32 32a8 8 0 0 1 8-8h40a8 8 0 0 1 8 8v22a8 8 0 0 1-8 8H56l-12 10v-10h-4a8 8 0 0 1-8-8V32z" fill={CARD} stroke={LINE} strokeWidth="2" strokeLinejoin="round" />
      <rect x="40" y="33" width="28" height="4" rx="2" fill={BRAND} />
      <rect x="40" y="42" width="40" height="4" rx="2" fill={MUTE} />
      <rect x="40" y="51" width="22" height="4" rx="2" fill={MUTE} />
      <circle cx="86" cy="26" r="7" fill={BRAND} /><path d="M83 26l2 2 4-4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Ground>
  ),
  key: (
    <Ground>
      <circle cx="50" cy="44" r="14" fill={CARD} stroke={LINE} strokeWidth="2" />
      <circle cx="50" cy="44" r="5" fill={SOFT} stroke={LINE} strokeWidth="2" />
      <path d="M62 44h26M80 44v9M88 44v6" stroke={BRAND} strokeWidth="5" strokeLinecap="round" />
      <path d="M43 34a14 14 0 0 1 14-3" stroke={BRAND} strokeWidth="3" strokeLinecap="round" fill="none" opacity=".7" />
    </Ground>
  ),
  news: (
    <Ground>
      <rect x="32" y="26" width="48" height="50" rx="7" fill={CARD} stroke={LINE} strokeWidth="2" />
      <rect x="39" y="33" width="34" height="14" rx="4" fill={BRAND} opacity=".85" />
      <rect x="39" y="52" width="34" height="4" rx="2" fill={MUTE} /><rect x="39" y="60" width="24" height="4" rx="2" fill={MUTE} />
      <rect x="72" y="38" width="22" height="34" rx="6" fill={CARD} stroke={LINE} strokeWidth="2" />
      <rect x="77" y="45" width="12" height="3" rx="1.5" fill={MUTE} /><rect x="77" y="52" width="12" height="3" rx="1.5" fill={MUTE} />
    </Ground>
  ),
  chart: (
    <Ground>
      <rect x="30" y="26" width="60" height="48" rx="8" fill={CARD} stroke={LINE} strokeWidth="2" />
      <path d="M38 62l12-14 10 8 14-18 8 6" stroke={BRAND} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M38 66h44" stroke={LINE} strokeWidth="2" strokeLinecap="round" />
      <circle cx="82" cy="36" r="4" fill={BRAND} />
    </Ground>
  ),
  shield: (
    <Ground>
      <path d="M60 24l22 8v16c0 14-9 22-22 28-13-6-22-14-22-28V32l22-8z" fill={CARD} stroke={LINE} strokeWidth="2" strokeLinejoin="round" />
      <path d="M60 24l22 8v16c0 14-9 22-22 28z" fill={BRAND} opacity=".18" />
      <path d="M50 50l7 7 13-14" stroke={BRAND} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Ground>
  ),
  plug: (
    <Ground>
      <path d="M48 28v12M72 28v12" stroke={BRAND} strokeWidth="5" strokeLinecap="round" />
      <rect x="38" y="40" width="44" height="22" rx="8" fill={CARD} stroke={LINE} strokeWidth="2" />
      <path d="M60 62v10c0 6 8 8 14 8" stroke={LINE} strokeWidth="3" strokeLinecap="round" fill="none" />
      <circle cx="52" cy="51" r="2.5" fill={MUTE} /><circle cx="68" cy="51" r="2.5" fill={MUTE} />
    </Ground>
  ),
  bell: (
    <Ground>
      <path d="M60 26c-11 0-17 8-17 19v10l-5 7h44l-5-7V45c0-11-6-19-17-19z" fill={CARD} stroke={LINE} strokeWidth="2" strokeLinejoin="round" />
      <path d="M54 72a6 6 0 0 0 12 0" stroke={BRAND} strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <circle cx="78" cy="30" r="6" fill={BRAND} />
    </Ground>
  ),
  users: (
    <Ground>
      <circle cx="50" cy="40" r="9" fill={CARD} stroke={LINE} strokeWidth="2" />
      <path d="M34 70c0-9 7-15 16-15s16 6 16 15" fill={CARD} stroke={LINE} strokeWidth="2" strokeLinecap="round" />
      <circle cx="76" cy="44" r="7" fill={BRAND} opacity=".85" />
      <path d="M66 70c0-7 5-12 12-12s12 5 12 12" fill={BRAND} opacity=".35" />
    </Ground>
  ),
  server: (
    <Ground>
      <rect x="34" y="28" width="52" height="18" rx="6" fill={CARD} stroke={LINE} strokeWidth="2" />
      <rect x="34" y="50" width="52" height="18" rx="6" fill={CARD} stroke={LINE} strokeWidth="2" />
      <circle cx="44" cy="37" r="3" fill={BRAND} /><circle cx="44" cy="59" r="3" fill={MUTE} />
      <path d="M54 37h22M54 59h22" stroke={MUTE} strokeWidth="3" strokeLinecap="round" />
    </Ground>
  ),
};

export function EmptyArt({ scene, size = 132 }: { scene: ArtScene; size?: number }) {
  return (
    <svg width={size} height={(size * 96) / 120} viewBox="0 0 120 96" fill="none" aria-hidden className="mx-auto">
      {SCENES[scene]}
    </svg>
  );
}
