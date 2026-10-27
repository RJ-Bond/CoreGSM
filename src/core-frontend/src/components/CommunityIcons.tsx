import type { ReactNode } from 'react';

/** small outline icons of the sections of the «Community» page (currentColor, decorative: the label next to them says the same) */
const ico = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {d}
  </svg>
);

const NOW = ico(<path d="M3 12h4l2.5 7 5-14L17 12h4" />);
const SEASON = ico(<><path d="M5 21V4" /><path d="M5 5h12l-2.5 4L17 13H5" /></>);
const WHEN = ico(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
const TOP = ico(<><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></>);
const FEED = ico(<><path d="M4 6h16M4 12h16M4 18h10" /></>);
const GALLERY = ico(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-8 8" /></>);
const SERVERS = ico(<><rect x="3" y="4" width="18" height="6.5" rx="2" /><rect x="3" y="13.5" width="18" height="6.5" rx="2" /><path d="M7 7.25h.01M7 16.75h.01" /></>);

/** the icon of a section of the page by the id of its block */
export const communityNavIcon = (id: string): ReactNode => (({ 'cm-now': NOW, 'cm-season': SEASON, 'cm-when': WHEN, 'cm-top': TOP, 'cm-feed': FEED, 'cm-gallery': GALLERY, 'cm-servers': SERVERS }) as Record<string, ReactNode>)[id] ?? null;
